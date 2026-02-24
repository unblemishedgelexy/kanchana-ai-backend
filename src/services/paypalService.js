import {
  PAYPAL_BASE_URL,
  PREMIUM_CURRENCY,
  PREMIUM_PRICE,
  PREMIUM_PAYPAL_PLAN_ID,
  FRONTEND_URL,
} from "../config.js";
import { HttpError } from "../utils/http.js";

export const isPaypalConfigured = () =>
  Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);

const fetchPaypal = async (path, options = {}) => {
  const response = await fetch(`${PAYPAL_BASE_URL}${path}`, options);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new HttpError(502, "PayPal request failed.", payload);
  }

  return payload;
};

const getAccessToken = async () => {
  if (!isPaypalConfigured()) {
    throw new HttpError(503, "PayPal is not configured.");
  }

  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  const basicAuth = Buffer.from(`${clientId}:${secret}`).toString("base64");

  const payload = await fetchPaypal("/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  return payload.access_token;
};

export const createPremiumOrder = async ({ userId }) => {
  const accessToken = await getAccessToken();

  const payload = await fetchPaypal("/v2/checkout/orders", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          custom_id: String(userId),
          amount: {
            currency_code: PREMIUM_CURRENCY,
            value: String(PREMIUM_PRICE),
          },
          description: "Kanchana Premium Upgrade",
        },
      ],
      application_context: {
        brand_name: "Kanchana AI",
        user_action: "PAY_NOW",
        return_url: `${FRONTEND_URL}/?paypalStatus=success`,
        cancel_url: `${FRONTEND_URL}/?paypalStatus=cancelled`,
      },
    }),
  });

  return payload;
};

export const captureOrder = async ({ orderId }) => {
  const accessToken = await getAccessToken();
  try {
    return await fetchPaypal(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    const isUnprocessable = error instanceof HttpError && error?.details?.name === "UNPROCESSABLE_ENTITY";
    if (isUnprocessable) {
      const issues = error?.details?.details || [];
      const orderNotApproved = issues.some((item) => item?.issue === "ORDER_NOT_APPROVED");
      const alreadyCaptured = issues.some((item) => item?.issue === "ORDER_ALREADY_CAPTURED");

      if (orderNotApproved) {
        throw new HttpError(409, "PayPal order is not approved yet. Complete checkout approval first.", {
          code: "PAYPAL_ORDER_NOT_APPROVED",
          orderId: String(orderId || ""),
        });
      }

      if (alreadyCaptured) {
        throw new HttpError(409, "PayPal order is already captured.", {
          code: "PAYPAL_ORDER_ALREADY_CAPTURED",
          orderId: String(orderId || ""),
        });
      }

      throw new HttpError(409, "PayPal order cannot be captured in current state.", {
        code: "PAYPAL_ORDER_NOT_CAPTUREABLE",
        orderId: String(orderId || ""),
      });
    }

    throw error;
  }
};

export const createSubscription = async ({ userId }) => {
  if (!PREMIUM_PAYPAL_PLAN_ID) {
    throw new HttpError(503, "PayPal subscription plan is not configured.");
  }

  const accessToken = await getAccessToken();
  try {
    return await fetchPaypal("/v1/billing/subscriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        plan_id: PREMIUM_PAYPAL_PLAN_ID,
        custom_id: String(userId),
        application_context: {
          brand_name: "Kanchana AI",
          user_action: "SUBSCRIBE_NOW",
          return_url: `${FRONTEND_URL}/?subscriptionStatus=success`,
          cancel_url: `${FRONTEND_URL}/?subscriptionStatus=cancelled`,
        },
      }),
    });
  } catch (error) {
    const resourceNotFound = error?.details?.name === "RESOURCE_NOT_FOUND";
    const invalidResourceId = (error?.details?.details || []).some(
      (item) => item?.issue === "INVALID_RESOURCE_ID"
    );

    if (error instanceof HttpError && resourceNotFound && invalidResourceId) {
      throw new HttpError(503, "PayPal subscription plan ID is invalid or not found.", {
        code: "PAYPAL_PLAN_INVALID",
        planId: PREMIUM_PAYPAL_PLAN_ID,
      });
    }

    throw error;
  }
};

export const verifyWebhookSignature = async ({ headers, webhookEvent }) => {
  if (!process.env.PAYPAL_WEBHOOK_ID) {
    return false;
  }

  const accessToken = await getAccessToken();
  const payload = await fetchPaypal("/v1/notifications/verify-webhook-signature", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      transmission_id: headers["paypal-transmission-id"],
      transmission_time: headers["paypal-transmission-time"],
      cert_url: headers["paypal-cert-url"],
      auth_algo: headers["paypal-auth-algo"],
      transmission_sig: headers["paypal-transmission-sig"],
      webhook_id: process.env.PAYPAL_WEBHOOK_ID,
      webhook_event: webhookEvent,
    }),
  });

  return payload?.verification_status === "SUCCESS";
};
