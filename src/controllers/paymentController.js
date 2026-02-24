
import { asyncHandler } from "../utils/http.js";
import {
  startPaypalOrder,
  capturePaypalOrderForUser,
  startPaypalSubscription,
  processPaypalWebhook,
  devUpgrade,
  getPremiumOverview,
} from "../services/paymentService.js";

export const createPaypalOrder = asyncHandler(async (req, res) => {
  const order = await startPaypalOrder({ user: req.user });
  return res.status(201).json(order);
});

export const premiumOverview = asyncHandler(async (req, res) => {
  const overview = await getPremiumOverview({ user: req.user });
  return res.json(overview);
});

export const capturePaypalPayment = asyncHandler(async (req, res) => {
  const result = await capturePaypalOrderForUser({
    user: req.user,
    orderId: req.body?.orderId,
  });

  return res.json(result);
});

export const createPaypalSubscriptionSession = asyncHandler(async (req, res) => {
  const session = await startPaypalSubscription({ user: req.user });
  return res.status(201).json(session);
});

export const paypalWebhook = asyncHandler(async (req, res) => {
  const result = await processPaypalWebhook({
    headers: req.headers,
    event: req.body,
  });

  return res.json(result);
});

export const upgradeInDevelopment = asyncHandler(async (req, res) => {
  const result = await devUpgrade(req.user);
  return res.json({
    message: "Premium upgraded successfully.",
    ...result,
  });
});
