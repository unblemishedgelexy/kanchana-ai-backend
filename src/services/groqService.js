import { GROQ_API_BASE_URL, GROQ_API_KEY, GROQ_CHAT_MODEL } from "../config.js";
import { HttpError } from "../utils/http.js";
import { hasPremiumAccess } from "../utils/accessControl.js";
import { buildSystemInstruction } from "./systemInstruction.js";

const DEFAULT_ERROR_MESSAGE = "AI response unavailable right now. Please retry in a moment.";
const DEFAULT_RETRY_MS = 60_000;

const roleMap = {
  user: "user",
  kanchana: "assistant",
  assistant: "assistant",
};

const emitDebug = (debug, level, stage, payload = {}) => {
  const log = debug?.[level];
  if (typeof log === "function") {
    log(stage, payload);
  }
};

const buildUnavailableError = (reason, details = {}) =>
  new HttpError(503, DEFAULT_ERROR_MESSAGE, {
    code: "AI_RESPONSE_UNAVAILABLE",
    provider: "groq",
    reason,
    ...details,
  });

const normalizeBaseUrl = () => String(GROQ_API_BASE_URL || "").replace(/\/+$/, "");

const getHistoryWindow = (user) => (hasPremiumAccess(user) ? 10 : 6);

const getMaxOutputTokens = ({ user, voiceMode }) => {
  if (voiceMode) {
    return hasPremiumAccess(user) ? 140 : 96;
  }
  return hasPremiumAccess(user) ? 420 : 260;
};

const normalizeHistory = (history = [], maxItems = 6) =>
  history
    .slice(-Math.max(1, Number(maxItems || 6)))
    .map((message) => {
      const text = String(message?.text || message?.content || "").trim();
      if (!text) {
        return null;
      }

      return {
        role: roleMap[message?.role] || "user",
        content: text,
      };
    })
    .filter(Boolean);

const parseRetryAfterMs = (payload = {}) => {
  const retryAfterHeader = Number(payload?.retry_after);
  if (Number.isFinite(retryAfterHeader) && retryAfterHeader > 0) {
    return retryAfterHeader * 1000;
  }

  const message = String(payload?.error?.message || "");
  const match = message.match(/retry.*?([\d.]+)\s*s/i);
  if (match) {
    const seconds = Number(match[1]);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.ceil(seconds * 1000);
    }
  }

  return DEFAULT_RETRY_MS;
};

const extractText = (payload = {}) => {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }
      return String(part?.text || "").trim();
    })
    .filter(Boolean)
    .join("\n")
    .trim();
};

const requestGroq = async ({ body }) => {
  if (!GROQ_API_KEY) {
    throw buildUnavailableError("missing_api_key");
  }

  const baseUrl = normalizeBaseUrl();
  if (!baseUrl) {
    throw buildUnavailableError("missing_base_url");
  }

  const endpoint = `${baseUrl}/chat/completions`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  const rawText = await response.text();
  let payload = {};
  try {
    payload = rawText ? JSON.parse(rawText) : {};
  } catch {
    payload = { raw: rawText };
  }

  if (!response.ok) {
    const statusCode = Number(response.status || 503);

    if (statusCode === 429) {
      throw new HttpError(429, "Groq rate limit reached.", {
        code: "AI_RESPONSE_UNAVAILABLE",
        provider: "groq",
        reason: "rate_limited",
        retryAfterMs: parseRetryAfterMs(payload),
      });
    }

    throw buildUnavailableError("upstream_non_ok", {
      statusCode,
      upstreamMessage: String(payload?.error?.message || "upstream_error"),
    });
  }

  return payload;
};

const buildApiLimitsInfo = ({ historyWindow, maxOutputTokens, voiceMode }) =>
  [
    `history_window=${historyWindow}`,
    `max_tokens=${maxOutputTokens}`,
    `voice_mode=${voiceMode ? "true" : "false"}`,
    "provider=groq",
  ].join("; ");

export const generateGroqReply = async ({
  user,
  mode,
  inputText,
  history = [],
  voiceMode = false,
  debug = null,
}) => {
  const safeInput = String(inputText || "").trim();
  if (!safeInput) {
    throw new HttpError(400, "Message text is required.");
  }

  const historyWindow = getHistoryWindow(user);
  const maxOutputTokens = getMaxOutputTokens({ user, voiceMode: Boolean(voiceMode) });
  const scopedHistory = normalizeHistory(history, historyWindow);
  const systemPrompt = buildSystemInstruction({
    user,
    mode,
    memoryContext: [],
    history: scopedHistory.map((item) => ({
      role: item.role === "assistant" ? "kanchana" : "user",
      text: item.content,
    })),
    currentInput: safeInput,
    providerName: "Groq",
    voiceMode: Boolean(voiceMode),
    maxTokens: maxOutputTokens,
    apiLimitsInfo: buildApiLimitsInfo({
      historyWindow,
      maxOutputTokens,
      voiceMode: Boolean(voiceMode),
    }),
  });

  emitDebug(debug, "event", "groq_request_started", {
    model: GROQ_CHAT_MODEL,
    historyCount: scopedHistory.length,
    inputLength: safeInput.length,
    voiceMode: Boolean(voiceMode),
  });

  try {
    const payload = await requestGroq({
      body: {
        model: GROQ_CHAT_MODEL,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          ...scopedHistory,
          {
            role: "user",
            content: safeInput,
          },
        ],
        temperature: 0.85,
        max_tokens: maxOutputTokens,
      },
    });

    const reply = extractText(payload);
    if (!reply) {
      throw buildUnavailableError("empty_reply");
    }

    emitDebug(debug, "event", "groq_response_received", {
      outputLength: reply.length,
    });

    return reply;
  } catch (error) {
    if (error instanceof HttpError) {
      emitDebug(debug, "warn", "groq_request_failed", {
        statusCode: Number(error?.statusCode || 503),
        reason: error?.details?.reason || "unknown",
        message: error?.message || "unknown_error",
      });
      throw error;
    }

    emitDebug(debug, "error", "groq_request_error", {
      message: error?.message || "unknown_error",
    });
    throw buildUnavailableError("request_failed");
  }
};
