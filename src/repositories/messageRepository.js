import mongoose from "mongoose";
import Message from "../models/Message.js";
import { memoryStore, createMemoryMessageId } from "../data/memoryStore.js";

const isMongoConnected = () => mongoose.connection.readyState === 1;

export const normalizeMessageId = (message) => String(message?._id || message?.id || "");

export const create = async ({ userId, mode, role, cipherText, iv, authTag, contentHash, vectorId = "" }) => {
  if (isMongoConnected()) {
    return Message.create({
      userId: String(userId),
      mode,
      role,
      cipherText,
      iv,
      authTag,
      contentHash,
      vectorId: String(vectorId || ""),
    });
  }

  const now = new Date();
  const message = {
    id: createMemoryMessageId(),
    userId: String(userId),
    mode,
    role,
    cipherText,
    iv,
    authTag,
    contentHash,
    vectorId: String(vectorId || ""),
    createdAt: now,
    updatedAt: now,
  };

  memoryStore.messages.push(message);
  return message;
};

export const listRecentByUserMode = async ({ userId, mode, limit = 40 }) => {
  const safeLimit = Math.max(1, Math.min(Number(limit || 40), 200));

  if (isMongoConnected()) {
    return Message.find({ userId: String(userId), mode }).sort({ createdAt: -1 }).limit(safeLimit);
  }

  return memoryStore.messages
    .filter((message) => message.userId === String(userId) && message.mode === mode)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, safeLimit);
};

export const listByIds = async ({ userId, ids = [] }) => {
  const normalizedIds = ids.map((id) => String(id || "").trim()).filter(Boolean);
  if (!normalizedIds.length) {
    return [];
  }

  if (isMongoConnected()) {
    return Message.find({
      userId: String(userId),
      _id: { $in: normalizedIds },
    }).sort({ createdAt: -1 });
  }

  return memoryStore.messages
    .filter(
      (message) =>
        message.userId === String(userId) && normalizedIds.includes(String(message.id || ""))
    )
    .sort((a, b) => b.createdAt - a.createdAt);
};

export const removeByUserMode = async ({ userId, mode }) => {
  if (isMongoConnected()) {
    const result = await Message.deleteMany({ userId: String(userId), mode });
    return result.deletedCount || 0;
  }

  const before = memoryStore.messages.length;
  memoryStore.messages = memoryStore.messages.filter(
    (message) => !(message.userId === String(userId) && message.mode === mode)
  );
  return before - memoryStore.messages.length;
};
