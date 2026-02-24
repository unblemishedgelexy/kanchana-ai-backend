import { promisify } from "util";
import { randomBytes, scrypt, timingSafeEqual } from "crypto";

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

export const hashPassword = async (plainPassword) => {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = await scryptAsync(plainPassword, salt, KEY_LENGTH);
  return `${salt}:${Buffer.from(derivedKey).toString("hex")}`;
};

export const verifyPassword = async (plainPassword, storedHash) => {
  const [salt, key] = String(storedHash || "").split(":");
  if (!salt || !key) {
    return false;
  }

  const derivedKey = await scryptAsync(plainPassword, salt, KEY_LENGTH);
  const keyBuffer = Buffer.from(key, "hex");
  const derivedBuffer = Buffer.from(derivedKey);

  if (keyBuffer.length !== derivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(keyBuffer, derivedBuffer);
};
