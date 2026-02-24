import express from "express";
import {
  register,
  login,
  googleLogin,
  googleOAuthStart,
  googleOAuthCallback,
  me,
  logout,
  patchPreferences,
  upgrade,
  forgotPassword,
  resetPasswordConfirm,
} from "../controllers/authController.js";
import { authRequired } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rateLimit.js";

const router = express.Router();

const authLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  message: "Too many auth requests. Please wait a minute.",
});

router.post("/register", authLimiter, register);
router.post("/login", authLimiter, login);
router.post("/google", authLimiter, googleLogin);
router.get("/google/start", authLimiter, googleOAuthStart);
router.get("/google/callback", googleOAuthCallback);
router.post("/forgot-password", authLimiter, forgotPassword);
router.post("/reset-password", authLimiter, resetPasswordConfirm);
router.get("/me", authRequired, me);
router.post("/logout", authRequired, logout);
router.patch("/preferences", authRequired, patchPreferences);
router.post("/upgrade", authRequired, upgrade);

export default router;
