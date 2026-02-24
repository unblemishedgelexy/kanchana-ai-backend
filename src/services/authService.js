import { PASSWORD_RESET_TTL_MINUTES, VALID_MODES, IS_PRODUCTION } from "../config.js";
import {
  normalizeEmail,
  createUser,
  findByEmail,
  findByGoogleSub,
  findById,
  save,
  addSession,
  removeSessionByHash,
  clearAllSessions,
  setPreferredMode,
  updateProfileName,
  setTier,
  setPasswordHash,
  setGoogleSub,
  toSafeUser,
} from "../repositories/userRepository.js";
import {
  create,
  findActiveByTokenHash,
  markUsed,
  invalidateUserTokens,
} from "../repositories/resetTokenRepository.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { createSession } from "../utils/token.js";
import { createSha256, randomToken } from "../utils/crypto.js";
import { HttpError } from "../utils/http.js";
import { verifyGoogleIdToken, verifyGoogleOAuthCode } from "./googleAuthService.js";

const validateEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));

export const registerWithPassword = async ({ name, email, password, userAgent }) => {
  const safeName = String(name || "").trim();
  const safeEmail = normalizeEmail(email);
  const safePassword = String(password || "");

  if (!safeName || !safeEmail || !safePassword) {
    throw new HttpError(400, "Name, email and password are required.");
  }

  if (!validateEmail(safeEmail)) {
    throw new HttpError(400, "Invalid email format.");
  }

  if (safePassword.length < 8) {
    throw new HttpError(400, "Password must be at least 8 characters.");
  }

  const existing = await findByEmail(safeEmail);
  if (existing) {
    throw new HttpError(409, "Email is already registered.");
  }

  const passwordHash = await hashPassword(safePassword);
  const user = await createUser({
    name: safeName,
    email: safeEmail,
    passwordHash,
  });

  const session = createSession();
  addSession(user, session, userAgent);
  await save(user);

  return {
    token: session.token,
    user: toSafeUser(user),
  };
};

export const loginWithPassword = async ({ email, password, userAgent }) => {
  const safeEmail = normalizeEmail(email);
  const safePassword = String(password || "");

  if (!safeEmail || !safePassword) {
    throw new HttpError(400, "Email and password are required.");
  }

  const user = await findByEmail(safeEmail);
  if (!user || !user.passwordHash) {
    throw new HttpError(401, "Invalid email or password.");
  }

  const validPassword = await verifyPassword(safePassword, user.passwordHash);
  if (!validPassword) {
    throw new HttpError(401, "Invalid email or password.");
  }

  const session = createSession();
  addSession(user, session, userAgent);
  await save(user);

  return {
    token: session.token,
    user: toSafeUser(user),
  };
};

const finalizeGoogleLogin = async ({ googleData, userAgent }) => {
  if (!googleData.emailVerified) {
    throw new HttpError(401, "Google email is not verified.");
  }

  let user = await findByGoogleSub(googleData.googleSub);
  if (!user) {
    user = await findByEmail(googleData.email);
  }

  if (!user) {
    user = await createUser({
      name: googleData.name,
      email: googleData.email,
      googleSub: googleData.googleSub,
    });
  } else if (!user.googleSub) {
    setGoogleSub(user, googleData.googleSub);
  }

  const session = createSession();
  addSession(user, session, userAgent);
  await save(user);

  return {
    token: session.token,
    user: toSafeUser(user),
  };
};

export const loginWithGoogle = async ({ idToken, userAgent }) => {
  const googleData = await verifyGoogleIdToken(idToken);
  return finalizeGoogleLogin({ googleData, userAgent });
};

export const loginWithGoogleAuthCode = async ({ code, userAgent }) => {
  const googleData = await verifyGoogleOAuthCode(code);
  return finalizeGoogleLogin({ googleData, userAgent });
};

export const logoutByTokenHash = async ({ user, tokenHash }) => {
  removeSessionByHash(user, tokenHash);
  await save(user);
};

export const updatePreferences = async ({ user, name, mode }) => {
  const safeName = String(name || "").trim();
  const safeMode = String(mode || "").trim();

  if (!safeName && !safeMode) {
    throw new HttpError(400, "No preference fields provided.");
  }

  if (safeMode && !VALID_MODES.includes(safeMode)) {
    throw new HttpError(400, "Invalid mode.");
  }

  if (safeName) {
    updateProfileName(user, safeName);
  }

  if (safeMode) {
    setPreferredMode(user, safeMode);
  }

  await save(user);
  return toSafeUser(user);
};

export const markPremium = async (user) => {
  setTier(user, "Premium");
  await save(user);
  return toSafeUser(user);
};

export const requestPasswordReset = async ({ email }) => {
  const safeEmail = normalizeEmail(email);
  if (!safeEmail || !validateEmail(safeEmail)) {
    return {
      message: "If that email exists, a password reset link has been sent.",
    };
  }

  const user = await findByEmail(safeEmail);
  if (!user) {
    return {
      message: "If that email exists, a password reset link has been sent.",
    };
  }

  await invalidateUserTokens(user.id || user._id);

  const rawToken = randomToken(32);
  const tokenHash = createSha256(rawToken);
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000);

  await create({
    userId: user.id || user._id,
    tokenHash,
    expiresAt,
  });

  return {
    message: "Password reset initiated.",
    ...(IS_PRODUCTION ? {} : { debugResetToken: rawToken }),
  };
};

export const resetPassword = async ({ token, newPassword }) => {
  const safeToken = String(token || "").trim();
  const safePassword = String(newPassword || "");

  if (!safeToken || !safePassword) {
    throw new HttpError(400, "Reset token and new password are required.");
  }

  if (safePassword.length < 8) {
    throw new HttpError(400, "New password must be at least 8 characters.");
  }

  const tokenHash = createSha256(safeToken);
  const resetRecord = await findActiveByTokenHash(tokenHash);
  if (!resetRecord) {
    throw new HttpError(400, "Invalid or expired reset token.");
  }

  const userId = String(resetRecord.userId);
  const user = await findById(userId);
  if (!user) {
    throw new HttpError(404, "User no longer exists.");
  }

  const passwordHash = await hashPassword(safePassword);
  setPasswordHash(user, passwordHash);
  clearAllSessions(user);
  await save(user);

  await markUsed(resetRecord);

  return {
    message: "Password updated successfully. Please login again.",
  };
};
