import {
  GEMINI_CHAT_MODEL,
  GEMINI_IMAGE_MODEL,
  GEMINI_EMBED_MODEL,
  MAX_FREE_MESSAGES,
  IS_PRODUCTION,
  AI_DEBUG_LOGS,
} from "../config.js";
import { HttpError } from "../utils/http.js";
import { buildSystemInstruction } from "./systemInstruction.js";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

const roleMap = {
  user: "user",
  kanchana: "model",
};

const getApiKey = () => process.env.GEMINI_API_KEY || "";
let geminiBackoffUntil = 0;
let lastRateLimitLogAt = 0;

const RATE_LIMIT_LOG_COOLDOWN_MS = 15_000;
const DEFAULT_RETRY_MS = 60_000;

const getHistoryWindow = (user) => (user?.tier === "Premium" ? 10 : 5);

const getMaxOutputTokens = ({ user, voiceMode }) => {
  const isPremium = user?.tier === "Premium";
  if (voiceMode) {
    return isPremium ? 140 : 96;
  }
  return isPremium ? 420 : 240;
};

const buildApiLimitsInfo = ({ user, historyWindow, maxTokens, voiceMode }) => {
  const used = Number(user?.messageCount || 0);
  const remainingFreeMessages = Math.max(0, MAX_FREE_MESSAGES - used);

  return [
    `history_window=${historyWindow}`,
    `max_tokens=${maxTokens}`,
    `voice_mode=${voiceMode ? "true" : "false"}`,
    `user_tier=${user?.tier === "Premium" ? "premium" : "normal"}`,
    `free_messages_remaining=${remainingFreeMessages}`,
  ].join("; ");
};

const summarizeDetails = (details) => {
  if (!details) {
    return null;
  }

  try {
    const text = JSON.stringify(details);
    return text.length > 800 ? `${text.slice(0, 800)}...` : text;
  } catch {
    return String(details);
  }
};

const parseRetryDelayMs = (details) => {
  const retryInfo = (details?.error?.details || []).find(
    (item) => item?.["@type"] === "type.googleapis.com/google.rpc.RetryInfo"
  );

  const retryDelayRaw = String(retryInfo?.retryDelay || "");
  const retryDelayMatch = retryDelayRaw.match(/^([\d.]+)s$/i);
  if (retryDelayMatch) {
    const seconds = Number(retryDelayMatch[1]);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.ceil(seconds * 1000);
    }
  }

  const retryMessage = String(details?.error?.message || "");
  const messageMatch = retryMessage.match(/retry in ([\d.]+)s/i);
  if (messageMatch) {
    const seconds = Number(messageMatch[1]);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.ceil(seconds * 1000);
    }
  }

  return DEFAULT_RETRY_MS;
};

const shouldLogGeminiWarning = (statusCode) => {
  if (statusCode !== 429) {
    return true;
  }

  const now = Date.now();
  if (now - lastRateLimitLogAt < RATE_LIMIT_LOG_COOLDOWN_MS) {
    return false;
  }

  lastRateLimitLogAt = now;
  return true;
};

const requestGemini = async (model, action, body) => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new HttpError(503, "Gemini API key is not configured on server.");
  }

  if (geminiBackoffUntil > Date.now()) {
    throw new HttpError(429, "Gemini temporarily paused due to previous rate limit.", {
      retryAfterMs: geminiBackoffUntil - Date.now(),
    });
  }

  const url =
    `${BASE_URL}/${encodeURIComponent(model)}:${action}?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    const mappedStatus = response.status >= 500 ? 502 : response.status;
    if (mappedStatus === 429) {
      const retryMs = parseRetryDelayMs(payload);
      geminiBackoffUntil = Date.now() + retryMs;
      throw new HttpError(429, "Gemini request failed.", {
        ...payload,
        retryAfterMs: retryMs,
      });
    }

    throw new HttpError(mappedStatus, "Gemini request failed.", payload);
  }

  return payload;
};

const historyToContents = (history = [], maxItems = 10) =>
  history
    .slice(-Math.max(1, Number(maxItems || 10)))
    .map((message) => {
      const text = String(message?.text || "").trim();
      if (!text) {
        return null;
      }

      return {
        role: roleMap[message.role] || "user",
        parts: [{ text }],
      };
    })
    .filter(Boolean);

const extractText = (payload) => {
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  return parts
    .map((part) => String(part?.text || ""))
    .join("\n")
    .trim();
};

const noProviderResponseError = () =>
  new HttpError(
    503,
    "AI response unavailable right now. Please retry in a moment.",
    { code: "AI_RESPONSE_UNAVAILABLE" }
  );

const emitDebug = (debug, level, stage, payload = {}) => {
  const log = debug?.[level];
  if (typeof log === "function") {
    log(stage, payload);
  }
};

export const generateChatReply = async ({
  user,
  mode,
  inputText,
  history,
  memoryContext = [],
  voiceMode = false,
  debug = null,
}) => {
  const historyWindow = getHistoryWindow(user);
  const maxOutputTokens = getMaxOutputTokens({ user, voiceMode });
  const scopedHistory = Array.isArray(history) ? history.slice(-historyWindow) : [];
  const scopedMemory = user?.tier === "Premium" ? memoryContext.slice(0, 6) : [];

  const apiLimitsInfo = buildApiLimitsInfo({
    user,
    historyWindow,
    maxTokens: maxOutputTokens,
    voiceMode,
  });

  const buildPromptForProvider = (providerName) =>
    buildSystemInstruction({
      user,
      mode,
      memoryContext: scopedMemory,
      history: scopedHistory,
      currentInput: inputText,
      providerName,
      voiceMode,
      maxTokens: maxOutputTokens,
      apiLimitsInfo,
    });

  const primarySystemPrompt = buildPromptForProvider("Gemini");

  emitDebug(debug, "event", "gemini_chat_prepare", {
    model: GEMINI_CHAT_MODEL,
    mode,
    inputLength: String(inputText || "").length,
    historyCount: scopedHistory.length,
    memoryCount: scopedMemory.length,
    voiceMode,
    maxOutputTokens,
  });

  try {
    emitDebug(debug, "event", "gemini_request_started", {
      model: GEMINI_CHAT_MODEL,
    });

    const payload = await requestGemini(GEMINI_CHAT_MODEL, "generateContent", {
      systemInstruction: {
        parts: [
          {
            text: primarySystemPrompt,
          },
        ],
      },
      contents: [
        ...historyToContents(scopedHistory, historyWindow),
        {
          role: "user",
          parts: [{ text: inputText }],
        },
      ],
      generationConfig: {
        temperature: 0.9,
        topP: 0.95,
        maxOutputTokens,
      },
    });

    const text = extractText(payload);
    if (text) {
      emitDebug(debug, "event", "gemini_response_received", {
        provider: "gemini",
        outputLength: text.length,
      });
      return text;
    }

    emitDebug(debug, "warn", "gemini_empty_response", {
      provider: "gemini",
    });

    throw noProviderResponseError();
  } catch (error) {
    if (error?.details?.code === "AI_RESPONSE_UNAVAILABLE") {
      emitDebug(debug, "error", "all_providers_failed", {
        statusCode: 503,
        message: error.message,
      });
      throw error;
    }

    emitDebug(debug, "warn", "gemini_request_failed", {
      statusCode: Number(error?.statusCode || 500),
      message: error?.message || "unknown_error",
      details: summarizeDetails(error?.details),
    });

    if (!IS_PRODUCTION && AI_DEBUG_LOGS && shouldLogGeminiWarning(error?.statusCode)) {
      // eslint-disable-next-line no-console
      console.warn("[ai:gemini] Gemini request failed.", {
        statusCode: error?.statusCode,
        message: error?.message || "unknown_error",
        details: summarizeDetails(error?.details),
      });
    }

    emitDebug(debug, "error", "all_providers_failed", {
      statusCode: Number(error?.statusCode || 503),
      message: error?.message || "unknown_error",
    });

    throw noProviderResponseError();
  }
};

export const generateImageResponse = async ({ prompt, debug = null }) => {
  emitDebug(debug, "event", "gemini_image_request_started", {
    model: GEMINI_IMAGE_MODEL,
    promptLength: String(prompt || "").length,
  });

  try {
    const payload = await requestGemini(GEMINI_IMAGE_MODEL, "generateContent", {
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Create a single cinematic image with mysterious poetic tone. Prompt: ${prompt}`,
            },
          ],
        },
      ],
    });

    const parts = payload?.candidates?.[0]?.content?.parts || [];
    let text = "";
    let imageUrl = "";

    parts.forEach((part) => {
      if (part?.text) {
        text += `${part.text}\n`;
      }

      if (part?.inlineData?.data && part?.inlineData?.mimeType) {
        imageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
      }
    });

    const response = {
      text: text.trim() || "Tumhari khwahish ko maine tasveer de di hai.",
      imageUrl,
    };

    emitDebug(debug, "event", "gemini_image_response_received", {
      outputLength: response.text.length,
      hasImageUrl: Boolean(response.imageUrl),
    });

    return response;
  } catch (error) {
    emitDebug(debug, "error", "gemini_image_request_failed", {
      statusCode: Number(error?.statusCode || 500),
      message: error?.message || "unknown_error",
      details: summarizeDetails(error?.details),
    });
    throw error;
  }
};

export const createEmbedding = async (text) => {
  const payload = await requestGemini(GEMINI_EMBED_MODEL, "embedContent", {
    content: {
      parts: [{ text: String(text || "") }],
    },
  });

  return payload?.embedding?.values || [];
};
