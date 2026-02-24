import mongoose from "mongoose";
import User from "../models/User.js";
import { memoryStore, createMemoryUserId } from "../data/memoryStore.js";
import { isSessionExpired } from "../utils/token.js";
import { normalizeRole, isHostUser } from "../utils/accessControl.js";

const isMongoConnected = () => mongoose.connection.readyState === 1;

export const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

export const normalizeUserId = (user) => String(user?._id || user?.id || "");

const sanitizeSessions = (sessions = []) =>
  sessions.filter((session) => session?.tokenHash && !isSessionExpired(session));

export const toSafeUser = (user) => ({
  id: normalizeUserId(user),
  name: user.name,
  email: user.email,
  tier: user.tier,
  role: normalizeRole(user),
  isHost: isHostUser(user),
  mode: user.preferredMode || user.mode || "Lovely",
  messageCount: Number(user.messageCount || 0),
  profileImageUrl: user.profileImageUrl || "",
  upgradeAssetUrl: user.upgradeAssetUrl || "",
  isAuthenticated: true,
});

export const toGuestSafeUser = ({ mode = "Lovely" } = {}) => ({
  id: "",
  name: "Guest",
  email: "",
  tier: "Free",
  role: "normal",
  isHost: false,
  mode: String(mode || "Lovely"),
  messageCount: 0,
  profileImageUrl: "",
  upgradeAssetUrl: "",
  isAuthenticated: false,
});

export const createUser = async ({ name, email, passwordHash = "", googleSub = "" }) => {
  const normalizedEmail = normalizeEmail(email);

  if (isMongoConnected()) {
    return User.create({
      name: String(name || "").trim(),
      email: normalizedEmail,
      passwordHash: String(passwordHash || ""),
      googleSub: String(googleSub || ""),
      tier: "Free",
      role: "normal",
      isHost: false,
      preferredMode: "Lovely",
      messageCount: 0,
      modeMessageCounts: {},
      voiceUsage: {
        dateKey: "",
        secondsUsed: 0,
      },
      profileImageUrl: "",
      upgradeAssetUrl: "",
      activeTokens: [],
      lastSeenAt: new Date(),
    });
  }

  const now = new Date();
  const user = {
    id: createMemoryUserId(),
    name: String(name || "").trim(),
    email: normalizedEmail,
    passwordHash: String(passwordHash || ""),
    googleSub: String(googleSub || ""),
    tier: "Free",
    role: "normal",
    isHost: false,
    preferredMode: "Lovely",
    messageCount: 0,
    modeMessageCounts: {},
    voiceUsage: {
      dateKey: "",
      secondsUsed: 0,
    },
    profileImageUrl: "",
    upgradeAssetUrl: "",
    activeTokens: [],
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  };

  memoryStore.users.push(user);
  return user;
};

export const findByEmail = async (email) => {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return null;
  }

  if (isMongoConnected()) {
    return User.findOne({ email: normalizedEmail });
  }

  return memoryStore.users.find((user) => user.email === normalizedEmail) || null;
};

export const findByGoogleSub = async (googleSub) => {
  const normalizedSub = String(googleSub || "").trim();
  if (!normalizedSub) {
    return null;
  }

  if (isMongoConnected()) {
    return User.findOne({ googleSub: normalizedSub });
  }

  return memoryStore.users.find((user) => user.googleSub === normalizedSub) || null;
};

export const findById = async (id) => {
  const normalizedId = String(id || "").trim();
  if (!normalizedId) {
    return null;
  }

  if (isMongoConnected()) {
    return User.findById(normalizedId);
  }

  return memoryStore.users.find((user) => String(user.id) === normalizedId) || null;
};

export const findBySessionTokenHash = async (tokenHash) => {
  const normalizedHash = String(tokenHash || "").trim();
  if (!normalizedHash) {
    return null;
  }

  if (isMongoConnected()) {
    return User.findOne({ "activeTokens.tokenHash": normalizedHash });
  }

  return (
    memoryStore.users.find((user) =>
      (user.activeTokens || []).some((session) => session.tokenHash === normalizedHash)
    ) || null
  );
};

export const save = async (user) => {
  if (!user) {
    return null;
  }

  user.activeTokens = sanitizeSessions(user.activeTokens || []);
  user.lastSeenAt = new Date();

  if (isMongoConnected()) {
    return user.save();
  }

  user.updatedAt = new Date();
  return user;
};

export const addSession = (user, session, userAgent = "") => {
  user.activeTokens = [
    {
      tokenHash: session.tokenHash,
      expiresAt: session.expiresAt,
      userAgent: String(userAgent || ""),
      createdAt: new Date(),
    },
    ...sanitizeSessions(user.activeTokens || []),
  ].slice(0, 8);

  return user;
};

export const removeSessionByHash = (user, tokenHash) => {
  user.activeTokens = sanitizeSessions(user.activeTokens || []).filter(
    (session) => session.tokenHash !== tokenHash
  );

  return user;
};

export const clearAllSessions = (user) => {
  user.activeTokens = [];
  return user;
};

export const setTier = (user, tier) => {
  user.tier = tier;
  return user;
};

export const setRole = (user, role) => {
  const safeRole = String(role || "").trim().toLowerCase() === "host" ? "host" : "normal";
  user.role = safeRole;
  user.isHost = safeRole === "host";
  return user;
};

export const setIsHost = (user, isHost) => {
  const safeIsHost = Boolean(isHost);
  user.isHost = safeIsHost;
  user.role = safeIsHost ? "host" : "normal";
  return user;
};

export const setPreferredMode = (user, mode) => {
  user.preferredMode = mode;
  return user;
};

export const updateProfileName = (user, name) => {
  user.name = String(name || "").trim();
  return user;
};

export const setPasswordHash = (user, passwordHash) => {
  user.passwordHash = passwordHash;
  return user;
};

export const setGoogleSub = (user, googleSub) => {
  user.googleSub = String(googleSub || "");
  return user;
};

export const incrementMessageCount = (user) => {
  user.messageCount = Number(user.messageCount || 0) + 1;
  return user;
};

const getModeCounterStore = (user) => {
  if (!user.modeMessageCounts) {
    user.modeMessageCounts = {};
  }

  return user.modeMessageCounts;
};

export const getModeMessageCount = (user, mode) => {
  const safeMode = String(mode || "").trim();
  if (!safeMode) {
    return 0;
  }

  const store = getModeCounterStore(user);
  if (typeof store.get === "function") {
    return Number(store.get(safeMode) || 0);
  }

  return Number(store[safeMode] || 0);
};

export const incrementModeMessageCount = (user, mode) => {
  const safeMode = String(mode || "").trim();
  if (!safeMode) {
    return user;
  }

  const store = getModeCounterStore(user);
  const nextCount = getModeMessageCount(user, safeMode) + 1;

  if (typeof store.set === "function") {
    store.set(safeMode, nextCount);
  } else {
    store[safeMode] = nextCount;
  }

  return user;
};

const getVoiceUsageStore = (user) => {
  if (!user.voiceUsage || typeof user.voiceUsage !== "object") {
    user.voiceUsage = {
      dateKey: "",
      secondsUsed: 0,
    };
  }

  return user.voiceUsage;
};

export const getVoiceUsageSecondsForDate = (user, dateKey) => {
  const safeDateKey = String(dateKey || "").trim();
  const voiceUsage = getVoiceUsageStore(user);

  if (!safeDateKey || voiceUsage.dateKey !== safeDateKey) {
    return 0;
  }

  return Number(voiceUsage.secondsUsed || 0);
};

export const addVoiceUsageSeconds = (user, dateKey, seconds) => {
  const safeDateKey = String(dateKey || "").trim();
  const incrementBy = Math.max(0, Number(seconds || 0));
  const voiceUsage = getVoiceUsageStore(user);

  if (!safeDateKey) {
    return user;
  }

  if (voiceUsage.dateKey !== safeDateKey) {
    voiceUsage.dateKey = safeDateKey;
    voiceUsage.secondsUsed = 0;
  }

  voiceUsage.secondsUsed = Number(voiceUsage.secondsUsed || 0) + incrementBy;
  return user;
};

export const setProfileImageUrl = (user, profileImageUrl) => {
  user.profileImageUrl = String(profileImageUrl || "");
  return user;
};

export const setUpgradeAssetUrl = (user, upgradeAssetUrl) => {
  user.upgradeAssetUrl = String(upgradeAssetUrl || "");
  return user;
};
