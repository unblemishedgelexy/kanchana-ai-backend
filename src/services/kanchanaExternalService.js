import { APP_API_KEY, APP_CLIENT_SECRET, KANCHANA_API_BASE_URL } from "../config.js";
import { HttpError } from "../utils/http.js";

const DEFAULT_ERROR_MESSAGE = "AI response unavailable right now. Please retry in a moment.";
const MAX_HISTORY_ITEMS = 10;

const emitDebug = (debug, level, stage, payload = {}) => {
  const log = debug?.[level];
  if (typeof log === "function") {
    log(stage, payload);
  }
};

const buildUnavailableError = (reason, details = {}) =>
  new HttpError(503, DEFAULT_ERROR_MESSAGE, {
    code: "AI_RESPONSE_UNAVAILABLE",
    provider: "kanchana_external",
    reason,
    ...details,
  });

const normalizeHistory = (history = []) =>
  history
    .slice(-MAX_HISTORY_ITEMS)
    .map((item) => {
      const content = String(item?.content || item?.text || "").trim();
      if (!content) {
        return null;
      }

      const role =
        item?.role === "kanchana" || item?.role === "assistant" ? "assistant" : "user";

      return { role, content };
    })
    .filter(Boolean);

const extractReply = (payload = {}) => String(payload?.reply || payload?.message || payload?.text || "").trim();
const resolveEndpoint = () => `${String(KANCHANA_API_BASE_URL || "").replace(/\/+$/, "")}/v1/chat`;

export const generateExternalFreeReply = async ({
  message,
  history = [],
  context = {},
  systemPrompt = "",
  debug = null,
}) => {
  const safeMessage = String(message || "").trim();
  if (!safeMessage) {
    throw new HttpError(400, "Message text is required.");
  }

  if (!APP_API_KEY || !APP_CLIENT_SECRET) {
    throw buildUnavailableError("missing_credentials");
  }

  const endpoint = resolveEndpoint();
  const safeSystemPrompt = String(systemPrompt || "").trim();
  const requestPayload = {
    message: safeMessage,
    history: normalizeHistory(history),
    context,
    ...(safeSystemPrompt ? { systemPrompt: safeSystemPrompt } : {}),
  };

  emitDebug(debug, "event", "free_external_request_started", {
    endpoint,
    messageLength: safeMessage.length,
    historyCount: requestPayload.history.length,
    hasSystemPrompt: Boolean(safeSystemPrompt),
  });

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": APP_API_KEY,
        "x-client-secret": APP_CLIENT_SECRET,
      },
      body: JSON.stringify(requestPayload),
    });

    const rawText = await response.text();
    let payload = {};
    try {
      payload = rawText ? JSON.parse(rawText) : {};
    } catch {
      payload = { raw: rawText };
    }

    if (!response.ok) {
      emitDebug(debug, "warn", "free_external_request_failed", {
        statusCode: response.status,
      });
      throw buildUnavailableError("upstream_non_ok", {
        statusCode: response.status,
      });
    }

    const reply = extractReply(payload);
    if (!reply) {
      emitDebug(debug, "warn", "free_external_empty_reply", {});
      throw buildUnavailableError("empty_reply");
    }

    emitDebug(debug, "event", "free_external_response_received", {
      outputLength: reply.length,
    });

    return reply;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }

    emitDebug(debug, "error", "free_external_request_error", {
      message: error?.message || "unknown_error",
    });

    throw buildUnavailableError("request_failed");
  }
};
