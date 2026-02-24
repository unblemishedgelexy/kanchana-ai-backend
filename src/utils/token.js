import { TOKEN_TTL_DAYS } from "../config.js";
import { createSha256, randomToken } from "./crypto.js";

export const createSession = () => {
  const token = randomToken(48);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + TOKEN_TTL_DAYS);

  return {
    token,
    tokenHash: createSha256(token),
    expiresAt,
  };
};

export const isSessionExpired = (session) =>
  !session?.expiresAt || new Date(session.expiresAt).getTime() <= Date.now();
