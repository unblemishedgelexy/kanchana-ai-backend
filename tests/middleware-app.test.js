import request from "supertest";
import mongoose from "mongoose";
import { describe, it, expect, jest } from "@jest/globals";
import { app, connectDatabase } from "../src/app.js";
import { authRequired, premiumRequired } from "../src/middleware/auth.js";
import { notFoundHandler, errorHandler } from "../src/middleware/errorHandlers.js";
import { HttpError } from "../src/utils/http.js";
import { createSha256 } from "../src/utils/crypto.js";
import * as userRepo from "../src/repositories/userRepository.js";

const createMockResponse = () => ({
  statusCode: 200,
  payload: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.payload = body;
    return this;
  },
});

describe("auth middleware", () => {
  it("should reject missing or invalid bearer token", async () => {
    const reqMissing = { headers: {} };
    const resMissing = createMockResponse();
    const nextMissing = jest.fn();

    await authRequired(reqMissing, resMissing, nextMissing);
    expect(resMissing.statusCode).toBe(401);
    expect(resMissing.payload.message).toContain("required");
    expect(nextMissing).not.toHaveBeenCalled();

    const reqInvalid = { headers: { authorization: "Bearer missing-token" } };
    const resInvalid = createMockResponse();
    const nextInvalid = jest.fn();

    await authRequired(reqInvalid, resInvalid, nextInvalid);
    expect(resInvalid.statusCode).toBe(401);
    expect(resInvalid.payload.message).toContain("Invalid or expired");
  });

  it("should reject expired sessions and allow valid sessions", async () => {
    const user = await userRepo.createUser({
      name: "Auth User",
      email: "auth.user@example.com",
      passwordHash: "hash",
    });

    const expiredToken = "expired-raw-token";
    user.activeTokens = [
      {
        tokenHash: createSha256(expiredToken),
        expiresAt: new Date(Date.now() - 1000),
        userAgent: "ua",
        createdAt: new Date(),
      },
    ];

    const reqExpired = { headers: { authorization: `Bearer ${expiredToken}` } };
    const resExpired = createMockResponse();
    const nextExpired = jest.fn();
    await authRequired(reqExpired, resExpired, nextExpired);
    expect(resExpired.statusCode).toBe(401);
    expect(resExpired.payload.message).toContain("Session expired");

    const validToken = "valid-raw-token";
    user.activeTokens = [
      {
        tokenHash: createSha256(validToken),
        expiresAt: new Date(Date.now() + 60_000),
        userAgent: "ua",
        createdAt: new Date(),
      },
    ];
    await userRepo.save(user);

    const reqValid = { headers: { authorization: `Bearer ${validToken}` } };
    const resValid = createMockResponse();
    const nextValid = jest.fn();
    await authRequired(reqValid, resValid, nextValid);
    expect(nextValid).toHaveBeenCalledTimes(1);
    expect(reqValid.user?.email).toBe("auth.user@example.com");
    expect(reqValid.safeUser?.isAuthenticated).toBe(true);
  });

  it("should enforce premium access checks", () => {
    const freeReq = { user: { tier: "Free" } };
    const freeRes = createMockResponse();
    const freeNext = jest.fn();
    premiumRequired(freeReq, freeRes, freeNext);
    expect(freeRes.statusCode).toBe(403);
    expect(freeRes.payload.code).toBe("PREMIUM_REQUIRED");
    expect(freeNext).not.toHaveBeenCalled();

    const premiumReq = { user: { tier: "Premium" } };
    const premiumRes = createMockResponse();
    const premiumNext = jest.fn();
    premiumRequired(premiumReq, premiumRes, premiumNext);
    expect(premiumNext).toHaveBeenCalledTimes(1);
  });
});

describe("error handlers", () => {
  it("should return a route-not-found payload", () => {
    const req = {
      method: "GET",
      originalUrl: "/api/unknown",
    };
    const res = createMockResponse();

    notFoundHandler(req, res);
    expect(res.statusCode).toBe(404);
    expect(res.payload.message).toContain("/api/unknown");
  });

  it("should format HttpError and generic 500 error responses", () => {
    const httpRes = createMockResponse();
    const next = jest.fn();

    errorHandler(
      new HttpError(400, "Bad input", {
        field: "email",
      }),
      {},
      httpRes,
      next
    );
    expect(httpRes.statusCode).toBe(400);
    expect(httpRes.payload.message).toBe("Bad input");
    expect(httpRes.payload.details.field).toBe("email");

    const serverRes = createMockResponse();
    const serverError = new Error("Internal detail");
    serverError.stack = "stack-trace";
    errorHandler(serverError, {}, serverRes, next);
    expect(serverRes.statusCode).toBe(500);
    expect(serverRes.payload.message).toContain("Something went wrong");
    expect(serverRes.payload.stack).toContain("stack-trace");
  });
});

describe("app and database hooks", () => {
  it("should process cors preflight and return 404 for unknown routes", async () => {
    const options = await request(app)
      .options("/api/ping")
      .set("Origin", "http://localhost:3000");

    expect(options.status).toBe(204);
    expect(options.headers["access-control-allow-origin"]).toBe("http://localhost:3000");

    const viteOptions = await request(app)
      .options("/api/ping")
      .set("Origin", "http://localhost:5173");

    expect(viteOptions.status).toBe(204);
    expect(viteOptions.headers["access-control-allow-origin"]).toBe("http://localhost:5173");

    const disallowed = await request(app).get("/api/ping").set("Origin", "http://evil.example.com");
    expect(disallowed.status).toBe(200);
    expect(disallowed.headers["access-control-allow-origin"]).toBeUndefined();

    const missingRoute = await request(app).get("/api/does-not-exist");
    expect(missingRoute.status).toBe(404);
    expect(missingRoute.body.message).toContain("Route not found");
  });

  it("should handle connectDatabase for no-uri, success, and failure branches", async () => {
    const connectSpy = jest.spyOn(mongoose, "connect");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    delete process.env.MONGODB_URI;
    await connectDatabase();
    expect(logSpy).toHaveBeenCalledWith("[backend] MONGODB_URI not set, using in-memory store.");
    expect(connectSpy).not.toHaveBeenCalled();

    process.env.MONGODB_URI = "mongodb://example/success";
    connectSpy.mockResolvedValueOnce({});
    await connectDatabase();
    expect(connectSpy).toHaveBeenCalledWith("mongodb://example/success");
    expect(logSpy).toHaveBeenCalledWith("[backend] Connected to MongoDB.");

    process.env.MONGODB_URI = "mongodb://example/fail";
    connectSpy.mockRejectedValueOnce(new Error("mongo down"));
    await connectDatabase();
    expect(errorSpy).toHaveBeenCalled();

    connectSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
