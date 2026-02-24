import express from "express";
import { authRequired } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rateLimit.js";
import { postMessage, getHistory, clearHistory } from "../controllers/chatController.js";

const router = express.Router();

const chatLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 45,
  message: "Chat rate limit exceeded. Please slow down.",
});

router.use(authRequired);
router.post("/message", chatLimiter, postMessage);
router.get("/history", getHistory);
router.delete("/history", clearHistory);

export default router;
