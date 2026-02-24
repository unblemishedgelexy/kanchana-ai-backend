import { asyncHandler } from "../utils/http.js";
import {
  registerWithPassword,
  loginWithPassword,
  loginWithGoogle,
  loginWithGoogleAuthCode,
  logoutByTokenHash,
  updatePreferences,
  markPremium,
  requestPasswordReset,
  resetPassword,
} from "../services/authService.js";
import { toSafeUser } from "../repositories/userRepository.js";
import {
  buildGoogleOAuthUrl,
  createGoogleOAuthState,
  parseGoogleOAuthState,
} from "../services/googleAuthService.js";
import { FRONTEND_URL, GOOGLE_AUTH_SUCCESS_REDIRECT, GOOGLE_AUTH_ERROR_REDIRECT } from "../config.js";

const resolveBaseUrl = (value, fallback) => {
  const safeValue = String(value || "").trim();
  if (safeValue) {
    return safeValue;
  }
  return String(fallback || FRONTEND_URL || "http://localhost:3000").trim();
};

const resolveRedirectTarget = ({ baseUrl, stateData = null }) => {
  const targetUrl = new URL(resolveBaseUrl(baseUrl, FRONTEND_URL));
  const redirectPath = String(stateData?.redirectPath || "").trim();
  if (redirectPath.startsWith("/")) {
    return new URL(redirectPath, targetUrl.origin);
  }
  return targetUrl;
};

const redirectWithHash = (res, targetUrl, hashParams = {}) => {
  const hash = new URLSearchParams(
    Object.entries(hashParams).reduce((acc, [key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        acc[key] = String(value);
      }
      return acc;
    }, {})
  ).toString();

  targetUrl.hash = hash;
  return res.redirect(targetUrl.toString());
};

export const register = asyncHandler(async (req, res) => {
  const result = await registerWithPassword({
    name: req.body?.name,
    email: req.body?.email,
    password: req.body?.password,
    userAgent: req.headers["user-agent"] || "",
  });

  return res.status(201).json(result);
});

export const login = asyncHandler(async (req, res) => {
  const result = await loginWithPassword({
    email: req.body?.email,
    password: req.body?.password,
    userAgent: req.headers["user-agent"] || "",
  });

  return res.json(result);
});

export const googleLogin = asyncHandler(async (req, res) => {
  const result = await loginWithGoogle({
    idToken: req.body?.idToken,
    userAgent: req.headers["user-agent"] || "",
  });

  return res.json(result);
});

export const googleOAuthStart = asyncHandler(async (req, res) => {
  const requestedRedirect = String(req.query?.redirect || "").trim();
  const redirectPath = requestedRedirect.startsWith("/") ? requestedRedirect : "";
  const state = createGoogleOAuthState({ redirectPath });
  const authUrl = buildGoogleOAuthUrl({ state });
  return res.redirect(authUrl);
});

export const googleOAuthCallback = asyncHandler(async (req, res) => {
  const format = String(req.query?.format || "").trim().toLowerCase();
  const stateRaw = String(req.query?.state || "").trim();
  const stateData = parseGoogleOAuthState(stateRaw);
  const requestedError = String(req.query?.error || "").trim();

  if (stateRaw && !stateData) {
    if (format === "json") {
      return res.status(400).json({ message: "Invalid or expired Google auth state." });
    }

    return redirectWithHash(
      res,
      resolveRedirectTarget({ baseUrl: GOOGLE_AUTH_ERROR_REDIRECT, stateData: null }),
      {
        provider: "google",
        error: "invalid_state",
      }
    );
  }

  if (requestedError) {
    if (format === "json") {
      return res.status(401).json({ message: "Google authorization was not granted." });
    }

    return redirectWithHash(
      res,
      resolveRedirectTarget({ baseUrl: GOOGLE_AUTH_ERROR_REDIRECT, stateData }),
      {
        provider: "google",
        error: requestedError,
      }
    );
  }

  try {
    const result = await loginWithGoogleAuthCode({
      code: req.query?.code,
      userAgent: req.headers["user-agent"] || "",
    });

    if (format === "json") {
      return res.json(result);
    }

    return redirectWithHash(
      res,
      resolveRedirectTarget({ baseUrl: GOOGLE_AUTH_SUCCESS_REDIRECT, stateData }),
      {
        provider: "google",
        token: result.token,
      }
    );
  } catch (error) {
    if (format === "json") {
      throw error;
    }

    return redirectWithHash(
      res,
      resolveRedirectTarget({ baseUrl: GOOGLE_AUTH_ERROR_REDIRECT, stateData }),
      {
        provider: "google",
        error: error?.details?.code || error?.code || "google_auth_failed",
      }
    );
  }
});

export const me = asyncHandler(async (req, res) => {
  return res.json({ user: toSafeUser(req.user) });
});

export const logout = asyncHandler(async (req, res) => {
  await logoutByTokenHash({
    user: req.user,
    tokenHash: req.authTokenHash,
  });

  return res.json({ message: "Logged out successfully." });
});

export const patchPreferences = asyncHandler(async (req, res) => {
  const user = await updatePreferences({
    user: req.user,
    name: req.body?.name,
    mode: req.body?.mode,
  });

  return res.json({
    message: "Preferences updated.",
    user,
  });
});

export const upgrade = asyncHandler(async (req, res) => {
  const user = await markPremium(req.user);
  return res.json({
    message: "Account upgraded to premium.",
    user,
  });
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const result = await requestPasswordReset({
    email: req.body?.email,
  });

  return res.json(result);
});

export const resetPasswordConfirm = asyncHandler(async (req, res) => {
  const result = await resetPassword({
    token: req.body?.token,
    newPassword: req.body?.newPassword,
  });

  return res.json(result);
});
