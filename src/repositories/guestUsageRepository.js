import mongoose from "mongoose";
import GuestUsage from "../models/GuestUsage.js";
import { memoryStore, createMemoryGuestUsageId } from "../data/memoryStore.js";

const isMongoConnected = () => mongoose.connection.readyState === 1;

const normalizeFingerprintHash = (value) => String(value || "").trim();
const normalizeMode = (value) => String(value || "").trim();

const applyMetadata = (record, metadata = {}) => {
  record.ipHash = String(metadata.ipHash || record.ipHash || "");
  record.deviceHash = String(metadata.deviceHash || record.deviceHash || "");
  record.sessionHash = String(metadata.sessionHash || record.sessionHash || "");
  record.userAgentHash = String(metadata.userAgentHash || record.userAgentHash || "");
  record.lastSeenAt = new Date();
  return record;
};

const persist = async (record) => {
  if (!record) {
    return null;
  }

  if (isMongoConnected()) {
    return record.save();
  }

  record.updatedAt = new Date();
  return record;
};

const ensureVoiceDate = (record, dateKey) => {
  const safeDateKey = String(dateKey || "").trim();
  if (!safeDateKey) {
    return record;
  }

  if (record.voiceUsageDateKey !== safeDateKey) {
    record.voiceUsageDateKey = safeDateKey;
    record.voiceSecondsUsed = 0;
  }

  return record;
};

export const getByFingerprintMode = async ({ fingerprintHash, mode, metadata = {} }) => {
  const safeFingerprintHash = normalizeFingerprintHash(fingerprintHash);
  const safeMode = normalizeMode(mode);
  if (!safeFingerprintHash || !safeMode) {
    return null;
  }

  if (isMongoConnected()) {
    try {
      return await GuestUsage.findOneAndUpdate(
        {
          fingerprintHash: safeFingerprintHash,
          mode: safeMode,
        },
        {
          $setOnInsert: {
            fingerprintHash: safeFingerprintHash,
            mode: safeMode,
            messageCount: 0,
            voiceUsageDateKey: "",
            voiceSecondsUsed: 0,
          },
          $set: {
            ipHash: String(metadata.ipHash || ""),
            deviceHash: String(metadata.deviceHash || ""),
            sessionHash: String(metadata.sessionHash || ""),
            userAgentHash: String(metadata.userAgentHash || ""),
            lastSeenAt: new Date(),
          },
        },
        {
          new: true,
          upsert: true,
        }
      );
    } catch (error) {
      // Retry once when unique index races during concurrent upserts.
      if (Number(error?.code) === 11000) {
        return GuestUsage.findOne({
          fingerprintHash: safeFingerprintHash,
          mode: safeMode,
        });
      }

      throw error;
    }
  }

  let record =
    memoryStore.guestUsages.find(
      (item) => item.fingerprintHash === safeFingerprintHash && item.mode === safeMode
    ) || null;

  if (!record) {
    const now = new Date();
    record = {
      id: createMemoryGuestUsageId(),
      fingerprintHash: safeFingerprintHash,
      mode: safeMode,
      messageCount: 0,
      voiceUsageDateKey: "",
      voiceSecondsUsed: 0,
      ipHash: "",
      deviceHash: "",
      sessionHash: "",
      userAgentHash: "",
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    };
    memoryStore.guestUsages.push(record);
  }

  applyMetadata(record, metadata);
  await persist(record);
  return record;
};

export const incrementGuestMessageCount = async ({ fingerprintHash, mode, metadata = {} }) => {
  const record = await getByFingerprintMode({ fingerprintHash, mode, metadata });
  if (!record) {
    return null;
  }

  record.messageCount = Number(record.messageCount || 0) + 1;
  applyMetadata(record, metadata);
  await persist(record);
  return record;
};

export const setGuestMessageCount = async ({ fingerprintHash, mode, count = 0, metadata = {} }) => {
  const record = await getByFingerprintMode({ fingerprintHash, mode, metadata });
  if (!record) {
    return null;
  }

  record.messageCount = Math.max(0, Number(count || 0));
  applyMetadata(record, metadata);
  await persist(record);
  return record;
};

export const getGuestVoiceUsageSeconds = async ({ fingerprintHash, mode, dateKey, metadata = {} }) => {
  const record = await getByFingerprintMode({ fingerprintHash, mode, metadata });
  if (!record) {
    return 0;
  }

  ensureVoiceDate(record, dateKey);
  await persist(record);
  return Number(record.voiceSecondsUsed || 0);
};

export const addGuestVoiceUsageSeconds = async ({
  fingerprintHash,
  mode,
  dateKey,
  seconds = 0,
  metadata = {},
}) => {
  const record = await getByFingerprintMode({ fingerprintHash, mode, metadata });
  if (!record) {
    return null;
  }

  ensureVoiceDate(record, dateKey);
  record.voiceSecondsUsed = Number(record.voiceSecondsUsed || 0) + Math.max(0, Number(seconds || 0));
  applyMetadata(record, metadata);
  await persist(record);
  return record;
};
