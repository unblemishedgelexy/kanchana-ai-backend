import crypto from "crypto";

export const createSha256 = (value) =>
  crypto.createHash("sha256").update(String(value || "")).digest("hex");

export const randomToken = (bytes = 48) => crypto.randomBytes(bytes).toString("hex");

export const encryptText = ({ text, key, aad = "" }) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  if (aad) {
    cipher.setAAD(Buffer.from(String(aad)));
  }

  const encrypted = Buffer.concat([cipher.update(String(text || ""), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    cipherText: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: tag.toString("base64"),
  };
};

export const decryptText = ({ cipherText, iv, authTag, key, aad = "" }) => {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(String(iv || ""), "base64")
  );

  if (aad) {
    decipher.setAAD(Buffer.from(String(aad)));
  }

  decipher.setAuthTag(Buffer.from(String(authTag || ""), "base64"));

  const plain = Buffer.concat([
    decipher.update(Buffer.from(String(cipherText || ""), "base64")),
    decipher.final(),
  ]);

  return plain.toString("utf8");
};
