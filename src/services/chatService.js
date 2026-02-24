import { MAX_FREE_MESSAGES, VALID_MODES } from "../config.js";
import { HttpError } from "../utils/http.js";
import { createSha256 } from "../utils/crypto.js";
import {
  create as createMessage,
  listRecentByUserMode,
  listByIds,
  removeByUserMode,
  normalizeMessageId,
} from "../repositories/messageRepository.js";
import { incrementMessageCount, save } from "../repositories/userRepository.js";
import { encryptForUser, decryptForUser } from "./encryptionService.js";
import { generateChatReply, generateImageResponse } from "./geminiService.js";
import { generateExternalFreeReply } from "./kanchanaExternalService.js";
import {
  vectorMemoryEnabled,
  upsertMessageVector,
  queryRelevantMessageIds,
} from "./vectorMemoryService.js";
import { isImageKitConfigured, uploadDataUriToImageKit } from "./imageKitService.js";
import {
  createChatDebugLogger,
  previewText,
  toDebugErrorPayload,
} from "../utils/chatDebugLogger.js";

const IMAGE_REQUEST_REGEX = /show me|draw|image of|picture of|dikhao|banao|tasveer/i;

const toClientMessage = (userId, messageRecord) => {
  const text = decryptForUser(userId, {
    cipherText: messageRecord.cipherText,
    iv: messageRecord.iv,
    authTag: messageRecord.authTag,
  });

  return {
    id: normalizeMessageId(messageRecord),
    role: messageRecord.role,
    text,
    timestamp: new Date(messageRecord.createdAt || Date.now()).getTime(),
  };
};

const saveEncryptedMessage = async ({ userId, mode, role, text }) => {
  const encrypted = encryptForUser(userId, text);
  const record = await createMessage({
    userId: String(userId),
    mode,
    role,
    cipherText: encrypted.cipherText,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
    contentHash: createSha256(text),
  });

  return record;
};

const loadHistory = async ({ userId, mode, limit = 40 }) => {
  const records = await listRecentByUserMode({ userId, mode, limit });
  const normalized = records
    .slice()
    .reverse()
    .map((item) => toClientMessage(userId, item));

  return normalized;
};

const buildMemoryContext = async ({ userId, mode, text }) => {
  if (!vectorMemoryEnabled) {
    return [];
  }

  const relevantIds = await queryRelevantMessageIds({
    userId,
    mode,
    text,
    topK: 4,
  });

  if (!relevantIds.length) {
    return [];
  }

  const relatedRecords = await listByIds({
    userId,
    ids: relevantIds,
  });

  return relatedRecords
    .slice(0, 4)
    .map((record) => {
      try {
        const decrypted = decryptForUser(userId, {
          cipherText: record.cipherText,
          iv: record.iv,
          authTag: record.authTag,
        });
        return `${record.role}: ${decrypted}`;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
};

export const sendMessage = async ({ user, mode, text, voiceMode = false, debug = {} }) => {
  const safeMode = VALID_MODES.includes(mode) ? mode : user.preferredMode || user.mode || "Lovely";
  const safeText = String(text || "").trim();
  const userId = String(user.id || user._id || "unknown");
  const startedAt = Date.now();

  const logger =
    debug?.logger ||
    createChatDebugLogger({
      requestId: debug?.requestId,
      userId,
      mode: safeMode,
      scope: "chatService.sendMessage",
    });

  logger.event("validation_started", {
    textLength: safeText.length,
    textPreview: previewText(safeText),
    voiceMode,
  });

  try {
    if (!safeText) {
      throw new HttpError(400, "Message text is required.");
    }

    if (safeText.length > 4000) {
      throw new HttpError(400, "Message is too long.");
    }

    const currentCount = Number(user.messageCount || 0);
    const isPremium = user.tier === "Premium";
    if (!isPremium && currentCount >= MAX_FREE_MESSAGES) {
      throw new HttpError(403, "Free tier limit reached. Upgrade to premium to continue.", {
        code: "FREE_TIER_LIMIT_REACHED",
      });
    }

    logger.event("validation_passed", {
      isPremium,
      currentCount,
      maxFreeMessages: MAX_FREE_MESSAGES,
      vectorMemoryEnabled,
    });

    const savedUserMessage = await saveEncryptedMessage({
      userId,
      mode: safeMode,
      role: "user",
      text: safeText,
    });

    logger.event("user_message_saved", {
      messageId: normalizeMessageId(savedUserMessage),
      role: "user",
    });

    const recentHistory = await loadHistory({ userId, mode: safeMode, limit: 12 });
    const memoryContext = isPremium
      ? await buildMemoryContext({ userId, mode: safeMode, text: safeText })
      : [];
    const imageRequested = IMAGE_REQUEST_REGEX.test(safeText);

    logger.event("context_built", {
      historyCount: recentHistory.length,
      memoryCount: memoryContext.length,
      imageRequested,
    });

    let assistantText = "";
    let imageUrl = "";
    const useGeminiForChat = isPremium || voiceMode;
    const useGeminiForImage = isPremium;

    if (imageRequested && useGeminiForImage) {
      logger.event("image_generation_started", {
        promptPreview: previewText(safeText),
      });

      const imageResponse = await generateImageResponse({
        prompt: safeText,
        debug: logger,
      });
      assistantText = imageResponse.text || "Tasveer tayyar hai.";
      imageUrl = imageResponse.imageUrl || "";

      logger.event("image_generation_completed", {
        hasImageData: Boolean(imageUrl),
        assistantTextLength: assistantText.length,
      });

      if (imageUrl && imageUrl.startsWith("data:") && isImageKitConfigured()) {
        logger.event("image_upload_started", {
          provider: "imagekit",
        });

        const uploaded = await uploadDataUriToImageKit({
          dataUri: imageUrl,
          fileName: `chat-image-${userId}-${Date.now()}`,
          folder: `/kanchana-ai/users/${userId}/chat-images`,
          tags: ["chat-image", userId, safeMode],
        });
        imageUrl = uploaded.url;

        logger.event("image_upload_completed", {
          imageUrlPreview: previewText(imageUrl),
        });
      }
    } else if (useGeminiForChat) {
      if (imageRequested) {
        logger.event("image_request_redirected_to_chat", {
          reason: "gemini_image_reserved_for_premium",
        });
      }

      logger.event("chat_generation_started", {
        provider: "gemini",
        historyCount: recentHistory.length,
        memoryCount: memoryContext.length,
        voiceMode,
      });

      assistantText = await generateChatReply({
        user,
        mode: safeMode,
        inputText: safeText,
        history: recentHistory,
        memoryContext,
        voiceMode,
        debug: logger,
      });

      logger.event("chat_generation_completed", {
        provider: "gemini",
        assistantTextLength: assistantText.length,
        assistantPreview: previewText(assistantText),
      });
    } else {
      if (imageRequested) {
        logger.event("image_request_redirected_to_chat", {
          reason: "free_tier_external_provider",
        });
      }

      const userMessageId = normalizeMessageId(savedUserMessage);
      const providerHistory = recentHistory.filter((message) => message.id !== userMessageId);

      logger.event("chat_generation_started", {
        provider: "kanchana_external",
        historyCount: providerHistory.length,
        memoryCount: 0,
        voiceMode: false,
      });

      assistantText = await generateExternalFreeReply({
        message: safeText,
        history: providerHistory,
        context: {
          mode: safeMode,
          tier: user?.tier || "Free",
          voiceMode: false,
        },
        debug: logger,
      });

      logger.event("chat_generation_completed", {
        provider: "kanchana_external",
        assistantTextLength: assistantText.length,
        assistantPreview: previewText(assistantText),
      });
    }

    const savedAssistantMessage = await saveEncryptedMessage({
      userId,
      mode: safeMode,
      role: "kanchana",
      text: assistantText,
    });

    logger.event("assistant_message_saved", {
      messageId: normalizeMessageId(savedAssistantMessage),
      role: "kanchana",
      hasImageUrl: Boolean(imageUrl),
    });

    if (isPremium && vectorMemoryEnabled) {
      try {
        await Promise.all([
          upsertMessageVector({
            userId,
            messageId: normalizeMessageId(savedUserMessage),
            mode: safeMode,
            text: safeText,
          }),
          upsertMessageVector({
            userId,
            messageId: normalizeMessageId(savedAssistantMessage),
            mode: safeMode,
            text: assistantText,
          }),
        ]);

        logger.event("vector_memory_upserted", {
          userMessageId: normalizeMessageId(savedUserMessage),
          assistantMessageId: normalizeMessageId(savedAssistantMessage),
        });
      } catch (error) {
        logger.warn("vector_memory_upsert_failed", {
          ...toDebugErrorPayload(error),
        });
      }
    }

    incrementMessageCount(user);
    await save(user);

    const response = {
      userMessage: {
        ...toClientMessage(userId, savedUserMessage),
      },
      assistantMessage: {
        ...toClientMessage(userId, savedAssistantMessage),
        ...(imageUrl ? { imageUrl } : {}),
      },
      usage: {
        messageCount: Number(user.messageCount || 0),
        maxFreeMessages: MAX_FREE_MESSAGES,
        isPremium: user.tier === "Premium",
      },
      safeMode,
    };

    logger.event("message_flow_completed", {
      durationMs: Date.now() - startedAt,
      usage: response.usage,
    });

    return response;
  } catch (error) {
    logger.error("message_flow_failed", {
      durationMs: Date.now() - startedAt,
      ...toDebugErrorPayload(error),
    });
    throw error;
  }
};

export const getHistoryByMode = async ({ user, mode, limit = 40 }) => {
  const safeMode = VALID_MODES.includes(mode) ? mode : user.preferredMode || user.mode || "Lovely";
  const userId = String(user.id || user._id);
  const messages = await loadHistory({ userId, mode: safeMode, limit });
  return { mode: safeMode, messages };
};

export const clearHistoryByMode = async ({ user, mode }) => {
  const safeMode = VALID_MODES.includes(mode) ? mode : user.preferredMode || user.mode || "Lovely";
  const userId = String(user.id || user._id);
  const deletedCount = await removeByUserMode({ userId, mode: safeMode });
  return { mode: safeMode, deletedCount };
};
