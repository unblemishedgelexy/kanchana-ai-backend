import {
  DEFAULT_VOICE_MESSAGE_SECONDS,
  FREE_DAILY_VOICE_SECONDS,
  FREE_MODE_MESSAGE_LIMIT,
  GUEST_MODE_MESSAGE_LIMIT,
  VALID_MODES,
} from "../config.js";
import { HttpError } from "../utils/http.js";
import { createSha256 } from "../utils/crypto.js";
import {
  create as createMessage,
  listRecentByUserMode,
  listByIds,
  removeByUserMode,
  normalizeMessageId,
} from "../repositories/messageRepository.js";
import {
  addVoiceUsageSeconds,
  getModeMessageCount,
  getVoiceUsageSecondsForDate,
  incrementMessageCount,
  incrementModeMessageCount,
  save,
} from "../repositories/userRepository.js";
import {
  getByFingerprintMode,
  incrementGuestMessageCount,
} from "../repositories/guestUsageRepository.js";
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
import { hasPremiumAccess, isHostUser, isPremiumUser } from "../utils/accessControl.js";

const IMAGE_REQUEST_REGEX = /show me|draw|image of|picture of|dikhao|banao|tasveer/i;

const toDateKeyUtc = (date = new Date()) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const throwCodeError = (statusCode, code, message, details = {}) => {
  const error = new HttpError(statusCode, message, {
    code,
    ...details,
  });
  error.code = code;
  throw error;
};

const resolveSafeMode = ({ mode, user }) => {
  const requestedMode = String(mode || "").trim();
  if (requestedMode) {
    if (!VALID_MODES.includes(requestedMode)) {
      throwCodeError(400, "INVALID_MODE", "Invalid mode.", {
        allowedModes: VALID_MODES,
      });
    }

    return requestedMode;
  }

  const preferredMode = String(user?.preferredMode || user?.mode || "Lovely").trim();
  return VALID_MODES.includes(preferredMode) ? preferredMode : "Lovely";
};

const resolveLimitProfile = ({ isAuthenticated, user }) => {
  const isHost = isHostUser(user);
  const isPremium = isPremiumUser(user);

  if (!isAuthenticated) {
    return {
      limitType: "guest",
      modeLimit: GUEST_MODE_MESSAGE_LIMIT,
      isPremium: false,
      isHost: false,
      isLimited: true,
    };
  }

  if (isHost) {
    return {
      limitType: "host",
      modeLimit: null,
      isPremium,
      isHost: true,
      isLimited: false,
    };
  }

  if (isPremium) {
    return {
      limitType: "premium",
      modeLimit: null,
      isPremium: true,
      isHost: false,
      isLimited: false,
    };
  }

  return {
    limitType: "free",
    modeLimit: FREE_MODE_MESSAGE_LIMIT,
    isPremium: false,
    isHost: false,
    isLimited: true,
  };
};

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

export const sendMessage = async ({
  user = null,
  isAuthenticated = Boolean(user),
  guestIdentity = null,
  mode,
  text,
  voiceMode = false,
  voiceDurationSeconds = DEFAULT_VOICE_MESSAGE_SECONDS,
  debug = {},
}) => {
  const authenticated = Boolean(isAuthenticated && user);
  const actorUser =
    user ||
    {
      id: guestIdentity?.guestUserId || "guest_unknown",
      tier: "Free",
      role: "normal",
      isHost: false,
      preferredMode: "Lovely",
    };
  const safeMode = resolveSafeMode({ mode, user: actorUser });
  const safeText = String(text || "").trim();
  const normalizedVoiceMode = Boolean(voiceMode);
  const requestedVoiceDuration = Number(voiceDurationSeconds);
  const normalizedVoiceDuration = Number.isFinite(requestedVoiceDuration)
    ? requestedVoiceDuration
    : DEFAULT_VOICE_MESSAGE_SECONDS;
  const safeVoiceDurationSeconds = Math.max(
    1,
    Math.min(600, Math.floor(normalizedVoiceDuration))
  );
  const userId = String(actorUser.id || actorUser._id || guestIdentity?.guestUserId || "unknown");
  const startedAt = Date.now();
  const limitProfile = resolveLimitProfile({
    isAuthenticated: authenticated,
    user: actorUser,
  });

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
    voiceMode: normalizedVoiceMode,
    voiceDurationSeconds: safeVoiceDurationSeconds,
    limitType: limitProfile.limitType,
  });

  try {
    if (!safeText) {
      throw new HttpError(400, "Message text is required.");
    }

    if (safeText.length > 4000) {
      throw new HttpError(400, "Message is too long.");
    }

    if (!authenticated && !guestIdentity?.fingerprintHash) {
      throw new HttpError(500, "Guest identity could not be resolved.");
    }

    if (normalizedVoiceMode && !authenticated) {
      throwCodeError(401, "VOICE_LOGIN_REQUIRED", "Voice is available only after login.");
    }

    const guestUsage = authenticated
      ? null
      : await getByFingerprintMode({
          fingerprintHash: guestIdentity.fingerprintHash,
          mode: safeMode,
          metadata: guestIdentity.metadata,
        });

    let modeMessageCount = authenticated
      ? getModeMessageCount(actorUser, safeMode)
      : Number(guestUsage?.messageCount || 0);

    if (limitProfile.isLimited && modeMessageCount >= Number(limitProfile.modeLimit || 0)) {
      throwCodeError(
        403,
        "MODE_LIMIT_REACHED",
        "Message limit reached for this mode. Upgrade to continue unlimited chat.",
        {
          mode: safeMode,
          modeLimit: limitProfile.modeLimit,
          messageCount: modeMessageCount,
          remainingMessages: 0,
          limitType: limitProfile.limitType,
        }
      );
    }

    const voiceUsageDateKey = toDateKeyUtc();
    const appliesFreeVoiceLimit = authenticated && limitProfile.limitType === "free" && normalizedVoiceMode;
    let dailyVoiceSecondsUsed = appliesFreeVoiceLimit
      ? getVoiceUsageSecondsForDate(actorUser, voiceUsageDateKey)
      : 0;

    if (
      appliesFreeVoiceLimit &&
      dailyVoiceSecondsUsed + safeVoiceDurationSeconds > FREE_DAILY_VOICE_SECONDS
    ) {
      const remainingVoiceSeconds = Math.max(0, FREE_DAILY_VOICE_SECONDS - dailyVoiceSecondsUsed);
      throwCodeError(
        403,
        "DAILY_VOICE_LIMIT_REACHED",
        "Daily voice limit reached for free users.",
        {
          dailyLimitSeconds: FREE_DAILY_VOICE_SECONDS,
          secondsUsed: dailyVoiceSecondsUsed,
          remainingVoiceSeconds,
          requestedVoiceSeconds: safeVoiceDurationSeconds,
          limitType: limitProfile.limitType,
        }
      );
    }

    logger.event("validation_passed", {
      limitType: limitProfile.limitType,
      modeMessageCount,
      modeLimit: limitProfile.modeLimit,
      dailyVoiceSecondsUsed,
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

    if (authenticated) {
      incrementMessageCount(actorUser);
      incrementModeMessageCount(actorUser, safeMode);
      modeMessageCount = getModeMessageCount(actorUser, safeMode);

      if (appliesFreeVoiceLimit) {
        addVoiceUsageSeconds(actorUser, voiceUsageDateKey, safeVoiceDurationSeconds);
        dailyVoiceSecondsUsed = getVoiceUsageSecondsForDate(actorUser, voiceUsageDateKey);
      }

      await save(actorUser);
    } else {
      const updatedGuestUsage = await incrementGuestMessageCount({
        fingerprintHash: guestIdentity.fingerprintHash,
        mode: safeMode,
        metadata: guestIdentity.metadata,
      });
      modeMessageCount = Number(updatedGuestUsage?.messageCount || modeMessageCount + 1);
    }

    const recentHistory = await loadHistory({ userId, mode: safeMode, limit: 12 });
    const hasUnlimitedAccess = hasPremiumAccess(actorUser);
    const memoryContext = hasUnlimitedAccess
      ? await buildMemoryContext({ userId, mode: safeMode, text: safeText })
      : [];
    const imageRequested = IMAGE_REQUEST_REGEX.test(safeText);

    logger.event("context_built", {
      historyCount: recentHistory.length,
      memoryCount: memoryContext.length,
      imageRequested,
      hasUnlimitedAccess,
    });

    let assistantText = "";
    let imageUrl = "";
    const useGeminiForChat = hasUnlimitedAccess || normalizedVoiceMode;
    const useGeminiForImage = hasUnlimitedAccess;

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
          reason: "gemini_image_reserved_for_unlimited",
        });
      }

      logger.event("chat_generation_started", {
        provider: "gemini",
        historyCount: recentHistory.length,
        memoryCount: memoryContext.length,
        voiceMode: normalizedVoiceMode,
      });

      assistantText = await generateChatReply({
        user: actorUser,
        mode: safeMode,
        inputText: safeText,
        history: recentHistory,
        memoryContext,
        voiceMode: normalizedVoiceMode,
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
          reason: "external_provider_no_image_generation",
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
          tier: actorUser?.tier || "Free",
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

    if (hasUnlimitedAccess && vectorMemoryEnabled) {
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

    const usage = {
      messageCount: modeMessageCount,
      maxFreeMessages: limitProfile.modeLimit,
      modeLimit: limitProfile.modeLimit,
      isPremium: limitProfile.isPremium,
      isHost: limitProfile.isHost,
      limitType: limitProfile.limitType,
      ...(limitProfile.isLimited
        ? {
            remainingMessages: Math.max(0, Number(limitProfile.modeLimit || 0) - modeMessageCount),
          }
        : {}),
    };

    const response = {
      userMessage: {
        ...toClientMessage(userId, savedUserMessage),
      },
      assistantMessage: {
        ...toClientMessage(userId, savedAssistantMessage),
        ...(imageUrl ? { imageUrl } : {}),
      },
      usage,
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
  const safeMode = resolveSafeMode({ mode, user });
  const userId = String(user.id || user._id);
  const messages = await loadHistory({ userId, mode: safeMode, limit });
  return { mode: safeMode, messages };
};

export const clearHistoryByMode = async ({ user, mode }) => {
  const safeMode = resolveSafeMode({ mode, user });
  const userId = String(user.id || user._id);
  const deletedCount = await removeByUserMode({ userId, mode: safeMode });
  return { mode: safeMode, deletedCount };
};
