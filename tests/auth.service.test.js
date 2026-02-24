import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { createSha256 } from "../src/utils/crypto.js";

const verifyGoogleIdTokenMock = jest.fn();
const verifyGoogleOAuthCodeMock = jest.fn();
jest.unstable_mockModule("../src/services/googleAuthService.js", () => ({
  verifyGoogleIdToken: verifyGoogleIdTokenMock,
  verifyGoogleOAuthCode: verifyGoogleOAuthCodeMock,
}));

const authService = await import("../src/services/authService.js");
const userRepo = await import("../src/repositories/userRepository.js");
const resetTokenRepo = await import("../src/repositories/resetTokenRepository.js");

describe("authService", () => {
  beforeEach(() => {
    verifyGoogleIdTokenMock.mockReset();
    verifyGoogleOAuthCodeMock.mockReset();
  });

  it("should validate register payload and reject duplicates", async () => {
    await expect(
      authService.registerWithPassword({
        name: "",
        email: "",
        password: "",
        userAgent: "jest",
      })
    ).rejects.toMatchObject({ statusCode: 400 });

    await expect(
      authService.registerWithPassword({
        name: "Neo",
        email: "invalid-email",
        password: "secret1234",
        userAgent: "jest",
      })
    ).rejects.toMatchObject({ statusCode: 400 });

    await expect(
      authService.registerWithPassword({
        name: "Neo",
        email: "neo@example.com",
        password: "short",
        userAgent: "jest",
      })
    ).rejects.toMatchObject({ statusCode: 400 });

    const first = await authService.registerWithPassword({
      name: "Neo",
      email: "neo@example.com",
      password: "secret1234",
      userAgent: "jest",
    });
    expect(first.token).toBeTruthy();

    await expect(
      authService.registerWithPassword({
        name: "Neo 2",
        email: "neo@example.com",
        password: "another1234",
        userAgent: "jest",
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("should login/logout and update preferences with validation", async () => {
    const registered = await authService.registerWithPassword({
      name: "Trinity",
      email: "trinity@example.com",
      password: "secret1234",
      userAgent: "ua-register",
    });

    await expect(
      authService.loginWithPassword({
        email: "",
        password: "",
        userAgent: "ua-login",
      })
    ).rejects.toMatchObject({ statusCode: 400 });

    await expect(
      authService.loginWithPassword({
        email: "not-found@example.com",
        password: "secret1234",
        userAgent: "ua-login",
      })
    ).rejects.toMatchObject({ statusCode: 401 });

    await expect(
      authService.loginWithPassword({
        email: "trinity@example.com",
        password: "wrong-password",
        userAgent: "ua-login",
      })
    ).rejects.toMatchObject({ statusCode: 401 });

    const login = await authService.loginWithPassword({
      email: "trinity@example.com",
      password: "secret1234",
      userAgent: "ua-login",
    });
    expect(login.token).toBeTruthy();
    expect(login.user.email).toBe("trinity@example.com");

    const user = await userRepo.findByEmail("trinity@example.com");
    expect(user?.activeTokens.length).toBeGreaterThan(0);

    await expect(
      authService.updatePreferences({
        user,
        name: "",
        mode: "",
      })
    ).rejects.toMatchObject({ statusCode: 400 });

    await expect(
      authService.updatePreferences({
        user,
        name: "",
        mode: "invalid-mode",
      })
    ).rejects.toMatchObject({ statusCode: 400 });

    const updated = await authService.updatePreferences({
      user,
      name: "Trinity Updated",
      mode: "Shayari",
    });
    expect(updated.name).toBe("Trinity Updated");
    expect(updated.mode).toBe("Shayari");

    await authService.logoutByTokenHash({
      user,
      tokenHash: createSha256(registered.token),
    });
    expect(user.activeTokens.some((item) => item.tokenHash === createSha256(registered.token))).toBe(
      false
    );

    const premium = await authService.markPremium(user);
    expect(premium.tier).toBe("Premium");
  });

  it("should run full password reset flow and enforce token validity", async () => {
    await authService.registerWithPassword({
      name: "Reset User",
      email: "reset@example.com",
      password: "oldsecret123",
      userAgent: "ua-reset",
    });

    const generic = await authService.requestPasswordReset({
      email: "invalid-email",
    });
    expect(generic.message).toContain("If that email exists");

    const forUnknown = await authService.requestPasswordReset({
      email: "unknown@example.com",
    });
    expect(forUnknown.message).toContain("If that email exists");

    const resetRequest = await authService.requestPasswordReset({
      email: "reset@example.com",
    });
    expect(resetRequest.debugResetToken).toBeTruthy();

    await expect(
      authService.resetPassword({
        token: "",
        newPassword: "newsecret123",
      })
    ).rejects.toMatchObject({ statusCode: 400 });

    await expect(
      authService.resetPassword({
        token: "invalid-token",
        newPassword: "newsecret123",
      })
    ).rejects.toMatchObject({ statusCode: 400 });

    await expect(
      authService.resetPassword({
        token: resetRequest.debugResetToken,
        newPassword: "short",
      })
    ).rejects.toMatchObject({ statusCode: 400 });

    const resetResult = await authService.resetPassword({
      token: resetRequest.debugResetToken,
      newPassword: "newsecret123",
    });
    expect(resetResult.message).toContain("Password updated successfully");

    await expect(
      authService.loginWithPassword({
        email: "reset@example.com",
        password: "oldsecret123",
        userAgent: "ua-login",
      })
    ).rejects.toMatchObject({ statusCode: 401 });

    const login = await authService.loginWithPassword({
      email: "reset@example.com",
      password: "newsecret123",
      userAgent: "ua-login",
    });
    expect(login.token).toBeTruthy();
  });

  it("should return 404 if reset token belongs to deleted user", async () => {
    await resetTokenRepo.create({
      userId: "missing-user-id",
      tokenHash: createSha256("reset-token-404"),
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(
      authService.resetPassword({
        token: "reset-token-404",
        newPassword: "newsecret123",
      })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("should support google login for new and existing users", async () => {
    verifyGoogleIdTokenMock.mockResolvedValueOnce({
      googleSub: "g-1",
      email: "google1@example.com",
      name: "Google One",
      emailVerified: false,
    });

    await expect(
      authService.loginWithGoogle({
        idToken: "id-token-1",
        userAgent: "ua-google",
      })
    ).rejects.toMatchObject({ statusCode: 401 });

    verifyGoogleIdTokenMock.mockResolvedValueOnce({
      googleSub: "g-2",
      email: "google2@example.com",
      name: "Google Two",
      emailVerified: true,
    });

    const created = await authService.loginWithGoogle({
      idToken: "id-token-2",
      userAgent: "ua-google",
    });
    expect(created.user.email).toBe("google2@example.com");

    await authService.registerWithPassword({
      name: "Email Existing",
      email: "linked@example.com",
      password: "secret1234",
      userAgent: "ua-link",
    });

    verifyGoogleIdTokenMock.mockResolvedValueOnce({
      googleSub: "g-linked",
      email: "linked@example.com",
      name: "Linked User",
      emailVerified: true,
    });

    const linked = await authService.loginWithGoogle({
      idToken: "id-token-3",
      userAgent: "ua-google",
    });
    expect(linked.user.email).toBe("linked@example.com");

    const user = await userRepo.findByEmail("linked@example.com");
    expect(user?.googleSub).toBe("g-linked");
  });

  it("should support google auth code callback login", async () => {
    verifyGoogleOAuthCodeMock.mockResolvedValueOnce({
      googleSub: "g-callback-1",
      email: "callback1@example.com",
      name: "Callback One",
      emailVerified: true,
    });

    const created = await authService.loginWithGoogleAuthCode({
      code: "auth-code-1",
      userAgent: "ua-google-callback",
    });
    expect(created.user.email).toBe("callback1@example.com");

    verifyGoogleOAuthCodeMock.mockResolvedValueOnce({
      googleSub: "g-callback-2",
      email: "callback2@example.com",
      name: "Callback Two",
      emailVerified: false,
    });

    await expect(
      authService.loginWithGoogleAuthCode({
        code: "auth-code-2",
        userAgent: "ua-google-callback",
      })
    ).rejects.toMatchObject({ statusCode: 401 });
  });
});
