import { ENCRYPTION_KEY } from "../config.js";
import { encryptText, decryptText } from "../utils/crypto.js";

const buildAad = (userId) => `kanchana:${String(userId || "")}`;

export const encryptForUser = (userId, plainText) =>
  encryptText({
    text: plainText,
    key: ENCRYPTION_KEY,
    aad: buildAad(userId),
  });

export const decryptForUser = (userId, payload) =>
  decryptText({
    cipherText: payload.cipherText,
    iv: payload.iv,
    authTag: payload.authTag,
    key: ENCRYPTION_KEY,
    aad: buildAad(userId),
  });

export const encryptJsonForUser = (userId, value) =>
  encryptForUser(userId, JSON.stringify(value || {}));

export const decryptJsonForUser = (userId, payload) => {
  const text = decryptForUser(userId, payload);
  return JSON.parse(text);
};
