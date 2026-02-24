import request from "supertest";
import { describe, expect, it } from "@jest/globals";
import { app } from "../src/app.js";

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
