import mongoose from "mongoose";
import PasswordResetToken from "../models/PasswordResetToken.js";
import { memoryStore, createMemoryResetId } from "../data/memoryStore.js";

const isMongoConnected = () => mongoose.connection.readyState === 1;

export const create = async ({ userId, tokenHash, expiresAt }) => {
  if (isMongoConnected()) {
    return PasswordResetToken.create({
      userId: String(userId),
      tokenHash,
      expiresAt,
      usedAt: null,
    });
  }

  const token = {
    id: createMemoryResetId(),
    userId: String(userId),
    tokenHash,
    expiresAt,
    usedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  memoryStore.resetTokens.push(token);
  return token;
};

export const findActiveByTokenHash = async (tokenHash) => {
  if (isMongoConnected()) {
    return PasswordResetToken.findOne({
      tokenHash,
      usedAt: null,
      expiresAt: { $gt: new Date() },
    });
  }

  return (
    memoryStore.resetTokens.find(
      (token) => token.tokenHash === tokenHash && !token.usedAt && token.expiresAt > new Date()
    ) || null
  );
};

export const markUsed = async (tokenRecord) => {
  if (!tokenRecord) {
    return null;
  }

  tokenRecord.usedAt = new Date();

  if (isMongoConnected()) {
    return tokenRecord.save();
  }

  tokenRecord.updatedAt = new Date();
  return tokenRecord;
};

export const invalidateUserTokens = async (userId) => {
  if (isMongoConnected()) {
    await PasswordResetToken.updateMany(
      { userId: String(userId), usedAt: null },
      { $set: { usedAt: new Date() } }
    );
    return;
  }

  const now = new Date();
  memoryStore.resetTokens.forEach((token) => {
    if (token.userId === String(userId) && !token.usedAt) {
      token.usedAt = now;
      token.updatedAt = now;
    }
  });
};
