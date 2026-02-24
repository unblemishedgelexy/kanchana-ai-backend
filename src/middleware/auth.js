import {
  findBySessionTokenHash,
  removeSessionByHash,
  save,
  toSafeUser,
} from "../repositories/userRepository.js";
import { createSha256 } from "../utils/crypto.js";
import { isSessionExpired } from "../utils/token.js";

const getBearerToken = (authorizationHeader = "") => {
  const [scheme, token] = String(authorizationHeader).split(" ");
  if (scheme !== "Bearer" || !token) {
    return null;
  }
  return token.trim();
};

export const authRequired = async (req, res, next) => {
  try {
    const rawToken = getBearerToken(req.headers.authorization);
    if (!rawToken) {
      return res.status(401).json({ message: "Authentication token is required." });
    }

    const tokenHash = createSha256(rawToken);
    const user = await findBySessionTokenHash(tokenHash);
    if (!user) {
      return res.status(401).json({ message: "Invalid or expired session." });
    }

    const session = (user.activeTokens || []).find((item) => item.tokenHash === tokenHash);
    if (!session || isSessionExpired(session)) {
      removeSessionByHash(user, tokenHash);
      await save(user);
      return res.status(401).json({ message: "Session expired. Please login again." });
    }

    req.user = user;
    req.authToken = rawToken;
    req.authTokenHash = tokenHash;
    req.safeUser = toSafeUser(user);
    return next();
  } catch (error) {
    return next(error);
  }
};

export const premiumRequired = (req, res, next) => {
  if (!req.user || req.user.tier !== "Premium") {
    return res.status(403).json({
      message: "Premium membership required for this route.",
      code: "PREMIUM_REQUIRED",
    });
  }

  return next();
};
