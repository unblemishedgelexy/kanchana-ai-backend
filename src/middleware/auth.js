import {
  findBySessionTokenHash,
  removeSessionByHash,
  save,
  toSafeUser,
} from "../repositories/userRepository.js";
import { createSha256 } from "../utils/crypto.js";
import { isSessionExpired } from "../utils/token.js";
import { hasPremiumAccess } from "../utils/accessControl.js";

const getBearerToken = (authorizationHeader = "") => {
  const [scheme, token] = String(authorizationHeader).split(" ");
  if (scheme !== "Bearer" || !token) {
    return null;
  }
  return token.trim();
};

export const authRequired = async (req, res, next) => {
  try {
    const authResult = await resolveAuthToken(req.headers.authorization);
    if (authResult.reason === "token_missing") {
      return res.status(401).json({ message: "Authentication token is required." });
    }

    if (authResult.reason === "invalid_session") {
      return res.status(401).json({ message: "Invalid or expired session." });
    }

    if (authResult.reason === "expired_session") {
      return res.status(401).json({ message: "Session expired. Please login again." });
    }

    req.user = authResult.user;
    req.authToken = authResult.rawToken;
    req.authTokenHash = authResult.tokenHash;
    req.safeUser = toSafeUser(authResult.user);
    return next();
  } catch (error) {
    return next(error);
  }
};

export const authOptional = async (req, res, next) => {
  try {
    const authResult = await resolveAuthToken(req.headers.authorization);

    if (authResult.reason === "token_missing") {
      req.user = null;
      req.authToken = null;
      req.authTokenHash = null;
      req.safeUser = null;
      return next();
    }

    if (authResult.reason === "invalid_session") {
      return res.status(401).json({ message: "Invalid or expired session." });
    }

    if (authResult.reason === "expired_session") {
      return res.status(401).json({ message: "Session expired. Please login again." });
    }

    req.user = authResult.user;
    req.authToken = authResult.rawToken;
    req.authTokenHash = authResult.tokenHash;
    req.safeUser = toSafeUser(authResult.user);
    return next();
  } catch (error) {
    return next(error);
  }
};

export const premiumRequired = (req, res, next) => {
  if (!req.user || !hasPremiumAccess(req.user)) {
    return res.status(403).json({
      message: "Premium membership required for this route.",
      code: "PREMIUM_REQUIRED",
    });
  }

  return next();
};

const resolveAuthToken = async (authorizationHeader) => {
  const rawToken = getBearerToken(authorizationHeader);
  if (!rawToken) {
    return { reason: "token_missing" };
  }

  const tokenHash = createSha256(rawToken);
  const user = await findBySessionTokenHash(tokenHash);
  if (!user) {
    return { reason: "invalid_session" };
  }

  const session = (user.activeTokens || []).find((item) => item.tokenHash === tokenHash);
  if (!session || isSessionExpired(session)) {
    removeSessionByHash(user, tokenHash);
    await save(user);
    return { reason: "expired_session" };
  }

  return {
    reason: "ok",
    rawToken,
    tokenHash,
    user,
  };
};
