import express from "express";
import { GUEST_CHAT_RATE_LIMIT_PER_MINUTE } from "../config.js";
import { authOptional, authRequired } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rateLimit.js";
import { postMessage, getHistory, clearHistory } from "../controllers/chatController.js";
import {
  validateChatMessageRequest,
  validateChatModeQuery,
  validateChatModeMutation,
} from "../middleware/validators/chatValidators.js";
import { resolveGuestIdentity } from "../utils/guestIdentity.js";

const router = express.Router();

const chatLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 45,
  message: "Chat rate limit exceeded. Please slow down.",
});

const guestChatLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: GUEST_CHAT_RATE_LIMIT_PER_MINUTE,
  message: "Guest chat rate limit exceeded. Please login or wait before retrying.",
  code: "GUEST_CHAT_RATE_LIMITED",
  skip: (req) => Boolean(req.user),
  keyResolver: (req) => resolveGuestIdentity(req).rateLimitKey,
});

router.post("/message", authOptional, guestChatLimiter, chatLimiter, validateChatMessageRequest, postMessage);

router.use(authRequired);
router.get("/history", validateChatModeQuery, getHistory);
router.delete("/history", validateChatModeMutation, clearHistory);

export default router;
