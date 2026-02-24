import { CHAT_DEBUG_LOGS } from "../config.js";

const MAX_PREVIEW_LENGTH = 160;

const trimString = (value) => String(value || "").replace(/\s+/g, " ").trim();

const truncate = (value, maxLength = MAX_PREVIEW_LENGTH) => {
  const text = trimString(value);
  if (!text) {
    return "";
  }

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength)}...`;
};

const toSafeError = (error) => ({
  name: error?.name || "Error",
  message: error?.message || "unknown_error",
  statusCode: Number(error?.statusCode || 500),
  code: error?.code || null,
});

const createTimestamp = () => new Date().toISOString();

const createContextPrefix = ({ requestId, userId, mode, scope }) =>
  [
    "[chat:debug]",
    requestId ? `request=${requestId}` : "",
    userId ? `user=${userId}` : "",
    mode ? `mode=${mode}` : "",
    scope ? `scope=${scope}` : "",
  ]
    .filter(Boolean)
    .join(" ");

const emitLog = (method, prefix, stage, payload) => {
  if (!CHAT_DEBUG_LOGS) {
    return;
  }

  const safePayload = {
    stage,
    timestamp: createTimestamp(),
    ...payload,
  };

  // eslint-disable-next-line no-console
  console[method](prefix, safePayload);
};

export const createDebugRequestId = () =>
  `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export const previewText = (value, maxLength = MAX_PREVIEW_LENGTH) => truncate(value, maxLength);

export const createChatDebugLogger = ({ requestId = "", userId = "", mode = "", scope = "" } = {}) => {
  const prefix = createContextPrefix({ requestId, userId, mode, scope });

  return {
    enabled: CHAT_DEBUG_LOGS,
    event: (stage, payload = {}) => emitLog("log", prefix, stage, payload),
    warn: (stage, payload = {}) => emitLog("warn", prefix, stage, payload),
    error: (stage, payload = {}) => emitLog("error", prefix, stage, payload),
  };
};

export const toDebugErrorPayload = (error) => toSafeError(error);
