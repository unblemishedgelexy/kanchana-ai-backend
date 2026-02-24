import request from "supertest";
import { describe, expect, it } from "@jest/globals";
import { app } from "../src/app.js";
import * as userRepo from "../src/repositories/userRepository.js";
import * as guestUsageRepo from "../src/repositories/guestUsageRepository.js";
import { resolveGuestIdentity } from "../src/utils/guestIdentity.js";

const registerUser = async ({ name = "Test User", email = "test@example.com" } = {}) => {
  const response = await request(app).post("/api/auth/register").send({
    name,
    email,
    password: "secret1234",
  });

  return response;
};

describe("System Routes", () => {
  it("GET /api/health should return service health", async () => {
    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
    expect(typeof response.body.timestamp).toBe("string");
  });

  it("GET /api/ping should return pong", async () => {
    const response = await request(app).get("/api/ping");

    expect(response.status).toBe(200);
    expect(response.body.pong).toBe(true);
  });
});

describe("Auth Routes", () => {
  it("should register, read profile, update preferences and logout", async () => {
    const register = await registerUser();
    expect(register.status).toBe(201);
    expect(register.body.token).toBeTruthy();
    expect(register.body.user.email).toBe("test@example.com");
    expect(register.body.user.role).toBe("normal");
    expect(register.body.user.isHost).toBe(false);

    const token = register.body.token;

    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.isAuthenticated).toBe(true);

    const preferences = await request(app)
      .patch("/api/auth/preferences")
      .set("Authorization", `Bearer ${token}`)
      .send({ mode: "Shayari", name: "Updated Soul" });

    expect(preferences.status).toBe(200);
    expect(preferences.body.user.mode).toBe("Shayari");
    expect(preferences.body.user.name).toBe("Updated Soul");

    const logout = await request(app).post("/api/auth/logout").set("Authorization", `Bearer ${token}`);
    expect(logout.status).toBe(200);

    const meAfterLogout = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);
    expect(meAfterLogout.status).toBe(401);
  });

  it("should fail login with invalid credentials", async () => {
    await registerUser();

    const response = await request(app).post("/api/auth/login").send({
      email: "test@example.com",
      password: "wrong-password",
    });

    expect(response.status).toBe(401);
  });

  it("forgot/reset password should work without env services", async () => {
    const forgotUnknown = await request(app).post("/api/auth/forgot-password").send({
      email: "unknown@example.com",
    });
    expect(forgotUnknown.status).toBe(200);
    expect(forgotUnknown.body.message).toContain("If that email exists");

    const resetInvalid = await request(app).post("/api/auth/reset-password").send({
      token: "invalid-token",
      newPassword: "newSecret123",
    });
    expect(resetInvalid.status).toBe(400);
  });

  it("google login should return 503 when google client is not configured", async () => {
    const response = await request(app).post("/api/auth/google").send({
      idToken: "dummy",
    });

    expect(response.status).toBe(503);
  });

  it("google oauth callback routes should return 503 when oauth callback config is missing", async () => {
    const start = await request(app).get("/api/auth/google/start");
    expect(start.status).toBe(503);

    const callback = await request(app).get("/api/auth/google/callback?code=dummy&format=json");
    expect(callback.status).toBe(503);
  });
});

describe("Content + Chat Routes", () => {
  it("should enforce premium access and return error when AI provider is unavailable", async () => {
    const register = await registerUser({
      name: "Chat User",
      email: "chat@example.com",
    });

    const token = register.body.token;

    const simple = await request(app).get("/api/content/simple");
    expect(simple.status).toBe(200);
    expect(simple.body.type).toBe("simple");

    const premiumBlocked = await request(app)
      .get("/api/content/premium")
      .set("Authorization", `Bearer ${token}`);
    expect(premiumBlocked.status).toBe(403);

    const chat = await request(app)
      .post("/api/chat/message")
      .set("Authorization", `Bearer ${token}`)
      .send({ mode: "Lovely", text: "Hello Kanchana" });

    expect(chat.status).toBe(503);
    expect(chat.body.message).toContain("AI response unavailable");

    const history = await request(app)
      .get("/api/chat/history?mode=Lovely")
      .set("Authorization", `Bearer ${token}`);
    expect(history.status).toBe(200);
    expect(Array.isArray(history.body.messages)).toBe(true);
    expect(history.body.messages.every((message) => message.role === "user")).toBe(true);

    const cleared = await request(app)
      .delete("/api/chat/history?mode=Lovely")
      .set("Authorization", `Bearer ${token}`);
    expect(cleared.status).toBe(200);
    expect(cleared.body.deletedCount).toBeGreaterThan(0);

    const historyAfterClear = await request(app)
      .get("/api/chat/history?mode=Lovely")
      .set("Authorization", `Bearer ${token}`);
    expect(historyAfterClear.status).toBe(200);
    expect(historyAfterClear.body.messages.length).toBe(0);
  });

  it("should reject guest voice chat with VOICE_LOGIN_REQUIRED", async () => {
    const response = await request(app).post("/api/chat/message").send({
      mode: "Lovely",
      text: "Voice test",
      voiceMode: true,
      voiceDurationSeconds: 30,
    });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe("VOICE_LOGIN_REQUIRED");
  });

  it("should enforce guest per-mode message limit with MODE_LIMIT_REACHED", async () => {
    const headers = {
      "x-forwarded-for": "198.51.100.20",
      "user-agent": "jest-guest-agent",
      "accept-language": "en-US",
      "x-device-id": "guest-device-1",
      "x-session-id": "guest-session-1",
    };

    const guestIdentity = resolveGuestIdentity({
      headers,
      ip: headers["x-forwarded-for"],
      socket: { remoteAddress: headers["x-forwarded-for"] },
    });

    await guestUsageRepo.setGuestMessageCount({
      fingerprintHash: guestIdentity.fingerprintHash,
      mode: "Lovely",
      count: 7,
      metadata: guestIdentity.metadata,
    });

    const response = await request(app)
      .post("/api/chat/message")
      .set("X-Forwarded-For", headers["x-forwarded-for"])
      .set("User-Agent", headers["user-agent"])
      .set("Accept-Language", headers["accept-language"])
      .set("X-Device-Id", headers["x-device-id"])
      .set("X-Session-Id", headers["x-session-id"])
      .send({
        mode: "Lovely",
        text: "Guest over limit",
      });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("MODE_LIMIT_REACHED");
    expect(response.body.details.limitType).toBe("guest");
    expect(response.body.details.modeLimit).toBe(7);
  });

  it("should enforce logged-in free per-mode limit and daily voice limit", async () => {
    const register = await registerUser({
      name: "Free User",
      email: "free-limit@example.com",
    });
    const token = register.body.token;
    const user = await userRepo.findByEmail("free-limit@example.com");

    user.modeMessageCounts = {
      Lovely: 10,
    };
    await userRepo.save(user);

    const modeLimit = await request(app)
      .post("/api/chat/message")
      .set("Authorization", `Bearer ${token}`)
      .send({
        mode: "Lovely",
        text: "Should hit free mode limit",
      });

    expect(modeLimit.status).toBe(403);
    expect(modeLimit.body.code).toBe("MODE_LIMIT_REACHED");
    expect(modeLimit.body.details.limitType).toBe("free");
    expect(modeLimit.body.details.modeLimit).toBe(10);

    user.modeMessageCounts = {};
    user.voiceUsage = {
      dateKey: new Date().toISOString().slice(0, 10),
      secondsUsed: 300,
    };
    await userRepo.save(user);

    const voiceLimit = await request(app)
      .post("/api/chat/message")
      .set("Authorization", `Bearer ${token}`)
      .send({
        mode: "Lovely",
        text: "Voice should be blocked now",
        voiceMode: true,
        voiceDurationSeconds: 60,
      });

    expect(voiceLimit.status).toBe(403);
    expect(voiceLimit.body.code).toBe("DAILY_VOICE_LIMIT_REACHED");
  });

  it("should allow premium and host users to bypass chat limits", async () => {
    const premiumRegister = await registerUser({
      name: "Premium Flow",
      email: "premium-flow@example.com",
    });
    const premiumToken = premiumRegister.body.token;
    const premiumUser = await userRepo.findByEmail("premium-flow@example.com");
    premiumUser.tier = "Premium";
    premiumUser.modeMessageCounts = {
      Lovely: 999,
    };
    await userRepo.save(premiumUser);

    const premiumChat = await request(app)
      .post("/api/chat/message")
      .set("Authorization", `Bearer ${premiumToken}`)
      .send({
        mode: "Lovely",
        text: "Premium should bypass mode limit",
      });

    expect(premiumChat.status).toBe(503);
    expect(premiumChat.body.code).not.toBe("MODE_LIMIT_REACHED");

    const hostRegister = await registerUser({
      name: "Host User",
      email: "host-flow@example.com",
    });
    const hostToken = hostRegister.body.token;
    const hostUser = await userRepo.findByEmail("host-flow@example.com");
    hostUser.role = "host";
    hostUser.isHost = true;
    hostUser.modeMessageCounts = {
      Lovely: 999,
    };
    await userRepo.save(hostUser);

    const hostPremiumContent = await request(app)
      .get("/api/content/premium")
      .set("Authorization", `Bearer ${hostToken}`);
    expect(hostPremiumContent.status).toBe(200);

    const hostChat = await request(app)
      .post("/api/chat/message")
      .set("Authorization", `Bearer ${hostToken}`)
      .send({
        mode: "Lovely",
        text: "Host should bypass mode limit",
      });

    expect(hostChat.status).toBe(503);
    expect(hostChat.body.code).not.toBe("MODE_LIMIT_REACHED");
  });
});

describe("Media + Payment Routes", () => {
  it("should return 503 for media/imagekit endpoints when imagekit is not configured", async () => {
    const register = await registerUser({
      name: "Media User",
      email: "media@example.com",
    });
    const token = register.body.token;

    const auth = await request(app)
      .get("/api/media/imagekit/auth")
      .set("Authorization", `Bearer ${token}`);

    expect(auth.status).toBe(503);
  });

  it("dev upgrade should unlock premium content without external payment config", async () => {
    const register = await registerUser({
      name: "Premium User",
      email: "premium@example.com",
    });
    const token = register.body.token;

    const devUpgrade = await request(app)
      .post("/api/payments/dev/upgrade")
      .set("Authorization", `Bearer ${token}`);
    expect(devUpgrade.status).toBe(200);
    expect(devUpgrade.body.user.tier).toBe("Premium");

    const premiumOverview = await request(app)
      .get("/api/payments/premium/overview")
      .set("Authorization", `Bearer ${token}`);
    expect(premiumOverview.status).toBe(200);
    expect(premiumOverview.body.isPremium).toBe(true);

    const premium = await request(app)
      .get("/api/content/premium")
      .set("Authorization", `Bearer ${token}`);
    expect(premium.status).toBe(200);
    expect(premium.body.type).toBe("premium");
  });

  it("paypal order should return 503 if paypal keys are not configured", async () => {
    const register = await registerUser({
      name: "Pay User",
      email: "pay@example.com",
    });
    const token = register.body.token;

    const order = await request(app)
      .post("/api/payments/paypal/order")
      .set("Authorization", `Bearer ${token}`);

    expect(order.status).toBe(503);
  });
});
