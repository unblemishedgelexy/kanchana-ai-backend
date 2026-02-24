import express from "express";
import {
  premiumOverview,
  createPaypalOrder,
  capturePaypalPayment,
  createPaypalSubscriptionSession,
  paypalWebhook,
  upgradeInDevelopment,
} from "../controllers/paymentController.js";
import { authRequired } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rateLimit.js";

const router = express.Router();

const paymentLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  message: "Too many payment requests. Please retry shortly.",
});

router.post("/paypal/webhook", paypalWebhook);
router.use(authRequired);
router.get("/premium/overview", premiumOverview);
router.post("/paypal/order", paymentLimiter, createPaypalOrder);
router.post("/paypal/capture", paymentLimiter, capturePaypalPayment);
router.post("/paypal/subscription", paymentLimiter, createPaypalSubscriptionSession);
router.post("/dev/upgrade", paymentLimiter, upgradeInDevelopment);

export default router;
