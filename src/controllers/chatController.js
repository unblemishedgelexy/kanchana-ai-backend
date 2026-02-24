import { asyncHandler } from "../utils/http.js";
import { sendMessage, getHistoryByMode, clearHistoryByMode } from "../services/chatService.js";
import { toSafeUser } from "../repositories/userRepository.js";
import {
  createChatDebugLogger,
  createDebugRequestId,
  previewText,
  toDebugErrorPayload,
} from "../utils/chatDebugLogger.js";

const parseVoiceMode = (value) => value === true || value === "true" || value === 1 || value === "1";
const getUserId = (user) => String(user?.id || user?._id || "");

const resolveRequestId = (req) => {
  const requestIdHeader = req.headers["x-request-id"];
  if (Array.isArray(requestIdHeader)) {
    return String(requestIdHeader[0] || "").trim() || createDebugRequestId();
  }

  const requestId = String(requestIdHeader || "").trim();
  return requestId || createDebugRequestId();
};

export const postMessage = asyncHandler(async (req, res) => {
  const requestId = resolveRequestId(req);
  const voiceMode = parseVoiceMode(req.body?.voiceMode);
  const userId = getUserId(req.user);
  const requestedMode = req.body?.mode || req.user?.preferredMode || req.user?.mode || "Lovely";
  const rawText = String(req.body?.text || "");
  const startedAt = Date.now();

  const logger = createChatDebugLogger({
    requestId,
    userId,
    mode: requestedMode,
    scope: "chatController.postMessage",
  });

  logger.event("request_received", {
    method: req.method,
    path: req.originalUrl,
    textLength: rawText.trim().length,
    textPreview: previewText(rawText),
    voiceMode,
    tier: req.user?.tier || "Free",
    messageCount: Number(req.user?.messageCount || 0),
  });

  let result;
  try {
    result = await sendMessage({
      user: req.user,
      mode: req.body?.mode,
      text: rawText,
      voiceMode,
      debug: {
        requestId,
        logger,
      },
    });
  } catch (error) {
    logger.error("request_failed", {
      durationMs: Date.now() - startedAt,
      ...toDebugErrorPayload(error),
    });
    throw error;
  }

  logger.event("response_sent", {
    statusCode: 200,
    durationMs: Date.now() - startedAt,
    userMessageId: result?.userMessage?.id || null,
    assistantMessageId: result?.assistantMessage?.id || null,
    usage: result?.usage || {},
  });

  res.setHeader("x-request-id", requestId);

  return res.json({
    userMessage: result.userMessage,
    assistantMessage: result.assistantMessage,
    usage: result.usage,
    mode: result.safeMode,
    user: toSafeUser(req.user),
  });
});

export const getHistory = asyncHandler(async (req, res) => {
  const requestId = resolveRequestId(req);
  const userId = getUserId(req.user);
  const requestedMode = req.query?.mode || req.user?.preferredMode || req.user?.mode || "Lovely";
  const limit = Number(req.query?.limit || 40);

  const logger = createChatDebugLogger({
    requestId,
    userId,
    mode: requestedMode,
    scope: "chatController.getHistory",
  });

  logger.event("history_request_received", {
    method: req.method,
    path: req.originalUrl,
    limit,
  });

  let result;
  try {
    result = await getHistoryByMode({
      user: req.user,
      mode: req.query?.mode,
      limit,
    });
  } catch (error) {
    logger.error("history_request_failed", toDebugErrorPayload(error));
    throw error;
  }

  logger.event("history_response_sent", {
    messageCount: Array.isArray(result?.messages) ? result.messages.length : 0,
  });

  res.setHeader("x-request-id", requestId);
  return res.json(result);
});

export const clearHistory = asyncHandler(async (req, res) => {
  const requestId = resolveRequestId(req);
  const userId = getUserId(req.user);
  const requestedMode =
    req.query?.mode || req.body?.mode || req.user?.preferredMode || req.user?.mode || "Lovely";

  const logger = createChatDebugLogger({
    requestId,
    userId,
    mode: requestedMode,
    scope: "chatController.clearHistory",
  });

  logger.event("clear_history_request_received", {
    method: req.method,
    path: req.originalUrl,
  });

  let result;
  try {
    result = await clearHistoryByMode({
      user: req.user,
      mode: req.query?.mode || req.body?.mode,
    });
  } catch (error) {
    logger.error("clear_history_request_failed", toDebugErrorPayload(error));
    throw error;
  }

  logger.event("clear_history_response_sent", {
    deletedCount: Number(result?.deletedCount || 0),
  });

  res.setHeader("x-request-id", requestId);
  return res.json({
    message: "History cleared.",
    ...result,
  });
});
