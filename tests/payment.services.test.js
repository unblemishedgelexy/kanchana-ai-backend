import { describe, it, expect, jest } from "@jest/globals";

const PAYPAL_ENV_KEYS = [
  "PAYPAL_CLIENT_ID",
  "PAYPAL_CLIENT_SECRET",
  "PREMIUM_PAYPAL_PLAN_ID",
  "PAYPAL_WEBHOOK_ID",
  "PAYPAL_MODE",
  "FRONTEND_URL",
  "PREMIUM_PRICE",
  "PREMIUM_CURRENCY",
];

const clearPaypalEnv = () => {
  PAYPAL_ENV_KEYS.forEach((key) => {
    delete process.env[key];
  });
};

const makeFetchResponse = ({ ok = true, status = 200, payload = {} } = {}) => ({
  ok,
  status,
  text: async () => JSON.stringify(payload),
});

const importPaypalService = async (env = {}) => {
  clearPaypalEnv();
  Object.entries(env).forEach(([key, value]) => {
    process.env[key] = String(value);
  });
  jest.resetModules();
  return import("../src/services/paypalService.js");
};

const importPaymentServiceWithMocks = async ({
  isConfigured = true,
  orderStatus = "CREATED",
  captureStatus = "COMPLETED",
  subscriptionStatus = "APPROVAL_PENDING",
  verified = true,
  paymentRecord = null,
  latestPayment = null,
  userById = null,
} = {}) => {
  jest.resetModules();

  const createPremiumOrder = jest.fn(async () => ({
    id: "order-1",
    intent: "CAPTURE",
    status: orderStatus,
    links: [{ rel: "approve", href: "https://paypal.example.com/approve" }],
  }));

  const captureOrder = jest.fn(async () => ({
    id: "order-1",
    status: captureStatus,
  }));

  const createSubscription = jest.fn(async () => ({
    id: "sub-1",
    status: subscriptionStatus,
    links: [{ rel: "approve", href: "https://paypal.example.com/sub-approve" }],
  }));

  const verifyWebhookSignature = jest.fn(async () => verified);
  const encryptJsonForUser = jest.fn(() => ({
    cipherText: "cipher",
    iv: "iv",
    authTag: "tag",
  }));
  const createPayment = jest.fn(async () => ({ id: "payment-1" }));
  const findByProviderRef = jest.fn(async () => paymentRecord);
  const findLatestByUserId = jest.fn(async () => latestPayment);
  const savePayment = jest.fn(async (value) => value);
  const findById = jest.fn(async () => userById);
  const toSafeUser = jest.fn((user) => ({
    id: String(user.id || user._id),
    tier: user.tier || "Free",
  }));
  const markPremium = jest.fn(async (user) => ({
    id: String(user.id || user._id),
    tier: "Premium",
  }));

  jest.unstable_mockModule("../src/services/paypalService.js", () => ({
    isPaypalConfigured: () => isConfigured,
    createPremiumOrder,
    captureOrder,
    createSubscription,
    verifyWebhookSignature,
  }));

  jest.unstable_mockModule("../src/services/encryptionService.js", () => ({
    encryptJsonForUser,
  }));

  jest.unstable_mockModule("../src/repositories/paymentRepository.js", () => ({
    create: createPayment,
    findByProviderRef,
    findLatestByUserId,
    save: savePayment,
  }));

  jest.unstable_mockModule("../src/repositories/userRepository.js", () => ({
    findById,
    toSafeUser,
  }));

  jest.unstable_mockModule("../src/services/authService.js", () => ({
    markPremium,
  }));

  const paymentService = await import("../src/services/paymentService.js");
  return {
    paymentService,
    mocks: {
      createPremiumOrder,
      captureOrder,
      createSubscription,
      verifyWebhookSignature,
      encryptJsonForUser,
      createPayment,
      findByProviderRef,
      findLatestByUserId,
      savePayment,
      findById,
      toSafeUser,
      markPremium,
    },
  };
};

describe("paypalService", () => {
  it("should reject calls when paypal is not configured", async () => {
    const paypalService = await importPaypalService();
    expect(paypalService.isPaypalConfigured()).toBe(false);
    await expect(paypalService.createPremiumOrder({ userId: "u1" })).rejects.toMatchObject({
      statusCode: 503,
    });
  });

  it("should create order and capture using PayPal fetch flow", async () => {
    const paypalService = await importPaypalService({
      PAYPAL_CLIENT_ID: "client",
      PAYPAL_CLIENT_SECRET: "secret",
      FRONTEND_URL: "http://localhost:3000",
      PREMIUM_PRICE: "999",
      PREMIUM_CURRENCY: "USD",
    });

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(makeFetchResponse({ payload: { access_token: "token-1" } }))
      .mockResolvedValueOnce(
        makeFetchResponse({
          payload: {
            id: "order-1",
            status: "CREATED",
            intent: "CAPTURE",
            links: [{ rel: "approve", href: "https://paypal.example.com/approve" }],
          },
        })
      )
      .mockResolvedValueOnce(makeFetchResponse({ payload: { access_token: "token-2" } }))
      .mockResolvedValueOnce(makeFetchResponse({ payload: { id: "order-1", status: "COMPLETED" } }));

    const order = await paypalService.createPremiumOrder({ userId: "u1" });
    expect(order.id).toBe("order-1");

    const capture = await paypalService.captureOrder({ orderId: "order-1" });
    expect(capture.status).toBe("COMPLETED");
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  it("should throw 503 for subscription when plan id is missing", async () => {
    const paypalService = await importPaypalService({
      PAYPAL_CLIENT_ID: "client",
      PAYPAL_CLIENT_SECRET: "secret",
    });

    await expect(paypalService.createSubscription({ userId: "u1" })).rejects.toMatchObject({
      statusCode: 503,
    });
  });

  it("should create subscription and verify webhook signature", async () => {
    const paypalService = await importPaypalService({
      PAYPAL_CLIENT_ID: "client",
      PAYPAL_CLIENT_SECRET: "secret",
      PREMIUM_PAYPAL_PLAN_ID: "P-PLAN",
      PAYPAL_WEBHOOK_ID: "WH-1",
    });

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(makeFetchResponse({ payload: { access_token: "token-sub" } }))
      .mockResolvedValueOnce(
        makeFetchResponse({
          payload: {
            id: "sub-1",
            status: "APPROVAL_PENDING",
          },
        })
      )
      .mockResolvedValueOnce(makeFetchResponse({ payload: { access_token: "token-webhook" } }))
      .mockResolvedValueOnce(
        makeFetchResponse({ payload: { verification_status: "SUCCESS" } })
      );

    const subscription = await paypalService.createSubscription({ userId: "u-sub" });
    expect(subscription.id).toBe("sub-1");

    const verified = await paypalService.verifyWebhookSignature({
      headers: {
        "paypal-transmission-id": "a",
        "paypal-transmission-time": "b",
        "paypal-cert-url": "c",
        "paypal-auth-algo": "d",
        "paypal-transmission-sig": "e",
      },
      webhookEvent: { event_type: "CHECKOUT.ORDER.APPROVED" },
    });
    expect(verified).toBe(true);
  });

  it("should map invalid subscription plan id to 503", async () => {
    const paypalService = await importPaypalService({
      PAYPAL_CLIENT_ID: "client",
      PAYPAL_CLIENT_SECRET: "secret",
      PREMIUM_PAYPAL_PLAN_ID: "P-INVALID",
    });

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(makeFetchResponse({ payload: { access_token: "token-sub" } }))
      .mockResolvedValueOnce(
        makeFetchResponse({
          ok: false,
          status: 404,
          payload: {
            name: "RESOURCE_NOT_FOUND",
            details: [{ issue: "INVALID_RESOURCE_ID" }],
          },
        })
      );

    await expect(paypalService.createSubscription({ userId: "u1" })).rejects.toMatchObject({
      statusCode: 503,
      details: { code: "PAYPAL_PLAN_INVALID" },
    });
  });

  it("should map unprocessable capture order to 409", async () => {
    const paypalService = await importPaypalService({
      PAYPAL_CLIENT_ID: "client",
      PAYPAL_CLIENT_SECRET: "secret",
      FRONTEND_URL: "http://localhost:3000",
      PREMIUM_PRICE: "999",
      PREMIUM_CURRENCY: "USD",
    });

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(makeFetchResponse({ payload: { access_token: "token-cap" } }))
      .mockResolvedValueOnce(
        makeFetchResponse({
          ok: false,
          status: 422,
          payload: {
            name: "UNPROCESSABLE_ENTITY",
            details: [{ issue: "ORDER_NOT_APPROVED" }],
          },
        })
      );

    await expect(paypalService.captureOrder({ orderId: "order-1" })).rejects.toMatchObject({
      statusCode: 409,
      details: { code: "PAYPAL_ORDER_NOT_APPROVED" },
    });
  });

  it("should return false when webhook id is missing and throw 502 on failed paypal request", async () => {
    const paypalService = await importPaypalService({
      PAYPAL_CLIENT_ID: "client",
      PAYPAL_CLIENT_SECRET: "secret",
    });

    const missingWebhookVerification = await paypalService.verifyWebhookSignature({
      headers: {},
      webhookEvent: {},
    });
    expect(missingWebhookVerification).toBe(false);

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(makeFetchResponse({ payload: { access_token: "token-1" } }))
      .mockResolvedValueOnce(
        makeFetchResponse({
          ok: false,
          status: 500,
          payload: { name: "INTERNAL_SERVER_ERROR" },
        })
      );

    await expect(paypalService.createPremiumOrder({ userId: "u1" })).rejects.toMatchObject({
      statusCode: 502,
    });
  });
});

describe("paymentService", () => {
  it("should start order and subscription and persist encrypted metadata", async () => {
    const { paymentService, mocks } = await importPaymentServiceWithMocks({
      isConfigured: true,
    });

    const user = { id: "u1", tier: "Free" };
    const order = await paymentService.startPaypalOrder({ user });
    expect(order.providerRef).toBe("order-1");
    expect(order.approvalUrl).toContain("paypal.example.com");
    expect(mocks.createPayment).toHaveBeenCalledTimes(1);
    expect(mocks.encryptJsonForUser).toHaveBeenCalledTimes(1);

    const subscription = await paymentService.startPaypalSubscription({ user });
    expect(subscription.providerRef).toBe("sub-1");
    expect(mocks.createPayment).toHaveBeenCalledTimes(2);
  });

  it("should handle capture outcomes and persist payment status", async () => {
    const existingPayment = {
      id: "p1",
      status: "CREATED",
    };

    const { paymentService, mocks } = await importPaymentServiceWithMocks({
      isConfigured: true,
      captureStatus: "COMPLETED",
      paymentRecord: existingPayment,
    });

    const completed = await paymentService.capturePaypalOrderForUser({
      user: { id: "u1", tier: "Free" },
      orderId: "order-1",
    });
    expect(completed.status).toBe("COMPLETED");
    expect(completed.user.tier).toBe("Premium");
    expect(mocks.savePayment).toHaveBeenCalled();

    const second = await importPaymentServiceWithMocks({
      isConfigured: true,
      captureStatus: "PENDING",
      paymentRecord: null,
    });

    const pending = await second.paymentService.capturePaypalOrderForUser({
      user: { id: "u2", tier: "Free" },
      orderId: "order-2",
    });
    expect(pending.status).toBe("PENDING");
    expect(second.mocks.toSafeUser).toHaveBeenCalled();
  });

  it("should validate capture payload and paypal config", async () => {
    const configured = await importPaymentServiceWithMocks({
      isConfigured: true,
    });

    await expect(
      configured.paymentService.capturePaypalOrderForUser({
        user: { id: "u1" },
        orderId: "",
      })
    ).rejects.toMatchObject({ statusCode: 400 });

    const unconfigured = await importPaymentServiceWithMocks({
      isConfigured: false,
    });

    await expect(
      unconfigured.paymentService.startPaypalOrder({
        user: { id: "u1" },
      })
    ).rejects.toMatchObject({ statusCode: 503 });

    await expect(
      unconfigured.paymentService.startPaypalSubscription({
        user: { id: "u1" },
      })
    ).rejects.toMatchObject({ statusCode: 503 });
  });

  it("should build premium overview with latest payment context", async () => {
    const latestPayment = {
      id: "payment-latest-1",
      provider: "paypal",
      flow: "order",
      providerRef: "order-latest-1",
      status: "CREATED",
      amount: 1.49,
      currency: "USD",
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      updatedAt: new Date("2025-01-01T01:00:00.000Z"),
    };

    const { paymentService, mocks } = await importPaymentServiceWithMocks({
      isConfigured: true,
      latestPayment,
    });

    const freeOverview = await paymentService.getPremiumOverview({
      user: { id: "u-overview-1", tier: "Free" },
    });
    expect(freeOverview.isPremium).toBe(false);
    expect(freeOverview.latestPayment?.providerRef).toBe("order-latest-1");
    expect(freeOverview.nextAction).toBe("subscription_plan_missing");
    expect(mocks.findLatestByUserId).toHaveBeenCalledWith("u-overview-1");

    const premiumOverview = await paymentService.getPremiumOverview({
      user: { id: "u-overview-2", tier: "Premium" },
    });
    expect(premiumOverview.isPremium).toBe(true);
    expect(premiumOverview.nextAction).toBe("premium_active");
  });

  it("should process webhook verification and premium activation", async () => {
    const paymentRecord = { id: "p1", status: "CREATED", userId: "u-webhook" };
    const webhook = await importPaymentServiceWithMocks({
      isConfigured: true,
      verified: true,
      paymentRecord,
      userById: { id: "u-webhook", tier: "Free" },
    });

    const response = await webhook.paymentService.processPaypalWebhook({
      headers: {
        "paypal-transmission-id": "id",
      },
      event: {
        event_type: "PAYMENT.CAPTURE.COMPLETED",
        resource: {
          id: "order-1",
        },
      },
    });

    expect(response.received).toBe(true);
    expect(webhook.mocks.savePayment).toHaveBeenCalled();
    expect(webhook.mocks.markPremium).toHaveBeenCalled();
  });

  it("should reject invalid webhook signatures and support dev upgrade", async () => {
    const invalid = await importPaymentServiceWithMocks({
      isConfigured: true,
      verified: false,
    });

    await expect(
      invalid.paymentService.processPaypalWebhook({
        headers: {},
        event: {},
      })
    ).rejects.toMatchObject({ statusCode: 401 });

    const dev = await importPaymentServiceWithMocks({
      isConfigured: true,
    });

    const upgraded = await dev.paymentService.devUpgrade({ id: "u-dev", tier: "Free" });
    expect(upgraded.user.tier).toBe("Premium");
  });
});
