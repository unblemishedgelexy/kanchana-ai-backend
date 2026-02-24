import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";
import {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_OAUTH_REDIRECT_URI,
  ENCRYPTION_KEY,
} from "../config.js";
import { HttpError } from "../utils/http.js";

const GOOGLE_SCOPES = ["openid", "email", "profile"];
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;
const googleOAuthClient =
  GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_OAUTH_REDIRECT_URI
    ? new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI)
    : null;

const toBase64Url = (value) => Buffer.from(String(value || ""), "utf8").toString("base64url");
const fromBase64Url = (value) => Buffer.from(String(value || ""), "base64url").toString("utf8");

const signState = (payload) =>
  crypto.createHmac("sha256", ENCRYPTION_KEY).update(String(payload || "")).digest("base64url");

const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(String(left || ""), "utf8");
  const rightBuffer = Buffer.from(String(right || ""), "utf8");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const toGoogleIdentity = (payload) => {
  if (!payload?.sub || !payload?.email) {
    throw new HttpError(401, "Invalid Google token payload.");
  }

  return {
    googleSub: payload.sub,
    email: payload.email,
    name: payload.name || payload.email.split("@")[0],
    emailVerified: Boolean(payload.email_verified),
  };
};

export const isGoogleOAuthConfigured = () =>
  Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_OAUTH_REDIRECT_URI && googleOAuthClient);

export const createGoogleOAuthState = ({ redirectPath = "" } = {}) => {
  const payload = toBase64Url(
    JSON.stringify({
      issuedAt: Date.now(),
      redirectPath: String(redirectPath || ""),
    })
  );
  const signature = signState(payload);
  return `${payload}.${signature}`;
};

export const parseGoogleOAuthState = (state) => {
  const rawState = String(state || "").trim();
  if (!rawState) {
    return null;
  }

  const [payload, signature] = rawState.split(".");
  if (!payload || !signature) {
    return null;
  }

  const expectedSignature = signState(payload);
  if (!safeEqual(expectedSignature, signature)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fromBase64Url(payload));
    const issuedAt = Number(parsed?.issuedAt || 0);
    if (!issuedAt || Date.now() - issuedAt > OAUTH_STATE_TTL_MS) {
      return null;
    }

    return {
      redirectPath: String(parsed?.redirectPath || ""),
    };
  } catch {
    return null;
  }
};

export const buildGoogleOAuthUrl = ({ state = "" } = {}) => {
  if (!isGoogleOAuthConfigured()) {
    throw new HttpError(503, "Google OAuth callback flow is not configured on server.");
  }

  return googleOAuthClient.generateAuthUrl({
    access_type: "offline",
    include_granted_scopes: true,
    prompt: "consent",
    scope: GOOGLE_SCOPES,
    ...(state ? { state } : {}),
  });
};

export const verifyGoogleIdToken = async (idToken) => {
  if (!GOOGLE_CLIENT_ID || !googleClient) {
    throw new HttpError(503, "Google login is not configured on server.");
  }

  if (!idToken) {
    throw new HttpError(400, "Google ID token is required.");
  }

  let ticket;
  try {
    ticket = await googleClient.verifyIdToken({
      idToken,
      audience: GOOGLE_CLIENT_ID,
    });
  } catch (error) {
    throw new HttpError(401, "Invalid Google ID token.", {
      code: "INVALID_GOOGLE_TOKEN",
      reason: String(error?.message || "verification_failed"),
    });
  }

  return toGoogleIdentity(ticket.getPayload());
};

export const verifyGoogleOAuthCode = async (code) => {
  if (!isGoogleOAuthConfigured()) {
    throw new HttpError(503, "Google OAuth callback flow is not configured on server.");
  }

  const safeCode = String(code || "").trim();
  if (!safeCode) {
    throw new HttpError(400, "Google auth code is required.");
  }

  let tokenResponse;
  try {
    tokenResponse = await googleOAuthClient.getToken(safeCode);
  } catch (error) {
    throw new HttpError(401, "Invalid Google auth code.", {
      code: "INVALID_GOOGLE_AUTH_CODE",
      reason: String(error?.message || "token_exchange_failed"),
    });
  }

  const idToken = String(tokenResponse?.tokens?.id_token || "").trim();
  if (!idToken) {
    throw new HttpError(401, "Google did not return an ID token.");
  }

  return verifyGoogleIdToken(idToken);
};
