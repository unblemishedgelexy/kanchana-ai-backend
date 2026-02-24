import { HttpError } from "../utils/http.js";
import {
  IS_PRODUCTION,
  PAYPAL_WEBHOOK_SKIP_VERIFY,
  PAYPAL_WEBHOOK_TEST_SECRET,
  PREMIUM_CURRENCY,
  PREMIUM_PRICE,
  PREMIUM_PAYPAL_PLAN_ID,
} from "../config.js";
import {
  isPaypalConfigured,
  createPremiumOrder,
  captureOrder,
  createSubscription,
  verifyWebhookSignature,
} from "./paypalService.js";
import { encryptJsonForUser } from "./encryptionService.js";
import {
  create,
  findByProviderRef,
  findLatestByUserId,
  save,
} from "../repositories/paymentRepository.js";
import { findById, toSafeUser } from "../repositories/userRepository.js";
import { markPremium } from "./authService.js";

const findApproveLink = (paypalPayload) =>
  (paypalPayload?.links || []).find((item) => item.rel === "approve")?.href || "";

const shouldBypassWebhookVerification = (headers = {}) => {
  if (IS_PRODUCTION || !PAYPAL_WEBHOOK_SKIP_VERIFY) {
    return false;
  }

  if (!PAYPAL_WEBHOOK_TEST_SECRET) {
    return true;
  }

  const providedSecret = String(headers["x-test-webhook-secret"] || "").trim();
  return providedSecret && providedSecret === PAYPAL_WEBHOOK_TEST_SECRET;
};

export const startPaypalOrder = async ({ user }) => {
  if (!isPaypalConfigured()) {
    throw new HttpError(503, "PayPal is not configured.");
  }

  const userId = String(user.id || user._id);
  const order = await createPremiumOrder({ userId });

  const encryptedMetadata = encryptJsonForUser(userId, {
    orderId: order.id,
    intent: order.intent,
  });

  await create({
    userId,
    provider: "paypal",
    flow: "order",
    providerRef: order.id,
    status: order.status || "CREATED",
    amount: PREMIUM_PRICE,
    currency: PREMIUM_CURRENCY,
    metadataCipherText: encryptedMetadata.cipherText,
    metadataIv: encryptedMetadata.iv,
    metadataAuthTag: encryptedMetadata.authTag,
  });

  return {
    providerRef: order.id,
    approvalUrl: findApproveLink(order),
    rawStatus: order.status || "CREATED",
  };
};

export const capturePaypalOrderForUser = async ({ user, orderId }) => {
  if (!orderId) {
    throw new HttpError(400, "orderId is required.");
  }

  const capture = await captureOrder({ orderId });
  const payment = await findByProviderRef(orderId);

  if (payment) {
    payment.status = capture.status || payment.status;
    await save(payment);
  }

  const captureStatus = String(capture?.status || "").toUpperCase();
  if (captureStatus === "COMPLETED") {
    const safeUser = await markPremium(user);
    return {
      status: "COMPLETED",
      user: safeUser,
      providerRef: orderId,
    };
  }

  return {
    status: captureStatus || "PENDING",
    user: toSafeUser(user),
    providerRef: orderId,
  };
};

const toSafePayment = (payment) => {
  if (!payment) {
    return null;
  }

  return {
    id: String(payment.id || payment._id || ""),
    provider: String(payment.provider || ""),
    flow: String(payment.flow || ""),
    providerRef: String(payment.providerRef || ""),
    status: String(payment.status || ""),
    amount: Number(payment.amount || 0),
    currency: String(payment.currency || ""),
    createdAt: payment.createdAt ? new Date(payment.createdAt).toISOString() : null,
    updatedAt: payment.updatedAt ? new Date(payment.updatedAt).toISOString() : null,
  };
};

export const getPremiumOverview = async ({ user }) => {
  const userId = String(user?.id || user?._id || "");
  const paypalConfigured = isPaypalConfigured();
  const subscriptionPlanConfigured = Boolean(PREMIUM_PAYPAL_PLAN_ID);
  const latestPayment = userId ? await findLatestByUserId(userId) : null;

  let nextAction = "premium_active";
  if (user?.tier !== "Premium") {
    if (!paypalConfigured) {
      nextAction = "paypal_not_configured";
    } else if (!subscriptionPlanConfigured) {
      nextAction = "subscription_plan_missing";
    } else {
      nextAction = "create_order_or_subscription";
    }
  }

  return {
    isPremium: user?.tier === "Premium",
    tier: user?.tier || "Free",
    pricing: {
      price: PREMIUM_PRICE,
      currency: PREMIUM_CURRENCY,
    },
    paypal: {
      configured: paypalConfigured,
      subscriptionPlanConfigured,
      mode: paypalConfigured ? "ready" : "disabled",
    },
    latestPayment: toSafePayment(latestPayment),
    nextAction,
  };
};

export const startPaypalSubscription = async ({ user }) => {
  if (!isPaypalConfigured()) {
    throw new HttpError(503, "PayPal is not configured.");
  }

  const userId = String(user.id || user._id);
  const subscription = await createSubscription({ userId });

  const encryptedMetadata = encryptJsonForUser(userId, {
    subscriptionId: subscription.id,
    status: subscription.status,
  });

  await create({
    userId,
    provider: "paypal",
    flow: "subscription",
    providerRef: subscription.id,
    status: subscription.status || "APPROVAL_PENDING",
    amount: PREMIUM_PRICE,
    currency: PREMIUM_CURRENCY,
    metadataCipherText: encryptedMetadata.cipherText,
    metadataIv: encryptedMetadata.iv,
    metadataAuthTag: encryptedMetadata.authTag,
  });

  return {
    providerRef: subscription.id,
    approvalUrl: findApproveLink(subscription),
    rawStatus: subscription.status || "APPROVAL_PENDING",
  };
};

export const processPaypalWebhook = async ({ headers, event }) => {
  if (!isPaypalConfigured()) {
    throw new HttpError(503, "PayPal is not configured.");
  }

  const bypassVerification = shouldBypassWebhookVerification(headers);
  const verified = bypassVerification
    ? true
    : await verifyWebhookSignature({ headers, webhookEvent: event });

  if (!verified) {
    throw new HttpError(401, "Invalid PayPal webhook signature.");
  }

  const eventType = String(event?.event_type || "");
  const resource = event?.resource || {};

  const providerRef = resource?.id || resource?.supplementary_data?.related_ids?.order_id;
  let payment = null;
  if (providerRef) {
    payment = await findByProviderRef(providerRef);
    if (payment) {
      payment.status = eventType;
      await save(payment);
    }
  }

  if (
    eventType === "BILLING.SUBSCRIPTION.ACTIVATED" ||
    eventType === "PAYMENT.SALE.COMPLETED" ||
    eventType === "PAYMENT.CAPTURE.COMPLETED"
  ) {
    const userId = String(payment?.userId || resource?.custom_id || "").trim();
    if (userId) {
      const user = await findById(userId);
      if (user) {
        await markPremium(user);
      }
    }
  }

  return { received: true };
};

export const devUpgrade = async (user) => {
  const upgraded = await markPremium(user);
  return { user: upgraded };
};
