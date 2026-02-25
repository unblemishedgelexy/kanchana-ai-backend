import {
  APP_API_KEY,
  APP_CLIENT_SECRET,
  BACKEND_AI_KEEPALIVE_ENABLED,
  BACKEND_AI_KEEPALIVE_HISTORY_LIMIT,
  BACKEND_AI_KEEPALIVE_INTERVAL_MS,
  FREE_CHAT_PROVIDER_ORDER,
  GROQ_API_KEY,
} from "../config.js";
import { listRecentGlobal } from "../repositories/messageRepository.js";
import { decryptForUser } from "./encryptionService.js";
import { generateFreeTierReply } from "./freeChatService.js";

let keepAliveTimer = null;
let keepAliveInFlight = false;

const normalizeText = (value) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 280);

const toTime = (value) => {
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const buildRecentDecryptedHistory = async (records = []) => {
  const decrypted = [];
  const safeRecords = records
    .slice()
    .sort((a, b) => toTime(a.createdAt) - toTime(b.createdAt));

  for (const item of safeRecords) {
    const role = item?.role === "kanchana" ? "kanchana" : item?.role === "user" ? "user" : "";
    if (!role) {
      continue;
    }

    const userId = String(item?.userId || "").trim();
    if (!userId) {
      continue;
    }

    try {
      const text = normalizeText(
        decryptForUser(userId, {
          cipherText: item.cipherText,
          iv: item.iv,
          authTag: item.authTag,
        })
      );
      if (!text) {
        continue;
      }
      decrypted.push({ role, text });
    } catch {
      // Ignore records that cannot be decrypted.
    }
  }

  return decrypted.slice(-BACKEND_AI_KEEPALIVE_HISTORY_LIMIT);
};

const runKeepAliveTick = async () => {
  if (keepAliveInFlight) {
    return;
  }

  keepAliveInFlight = true;
  try {
    const records = await listRecentGlobal({
      limit: Math.max(10, BACKEND_AI_KEEPALIVE_HISTORY_LIMIT * 5),
    });
    const history = await buildRecentDecryptedHistory(records);
    const latestUserText =
      [...history].reverse().find((item) => item.role === "user")?.text || "";

    const warmupMessage = latestUserText
      ? `Warmup ping for model readiness. Latest user intent sample: "${latestUserText}"`
      : "Warmup ping for model readiness. Stay prepared for the next conversation.";

    await generateFreeTierReply({
      user: {
        id: "keepalive_worker",
        name: "Kanchana Keepalive",
        tier: "Free",
        role: "normal",
      },
      mode: "Lovely",
      inputText: warmupMessage,
      history,
      voiceMode: false,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("[backend] AI-model keepalive tick failed:", error?.message || error);
  } finally {
    keepAliveInFlight = false;
  }
};

const canStartKeepAlive = () => {
  if (!BACKEND_AI_KEEPALIVE_ENABLED) {
    return false;
  }

  const providerOrder = Array.isArray(FREE_CHAT_PROVIDER_ORDER) ? FREE_CHAT_PROVIDER_ORDER : [];
  const groqEnabled = providerOrder.includes("groq") && String(GROQ_API_KEY || "").trim();
  const externalEnabled =
    providerOrder.includes("kanchana_external") &&
    String(APP_API_KEY || "").trim() &&
    String(APP_CLIENT_SECRET || "").trim();

  if (!groqEnabled && !externalEnabled) {
    return false;
  }

  return true;
};

export const stopAiModelKeepAliveLoop = () => {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
};

export const startAiModelKeepAliveLoop = () => {
  if (keepAliveTimer) {
    return stopAiModelKeepAliveLoop;
  }

  if (!canStartKeepAlive()) {
    // eslint-disable-next-line no-console
    console.log("[backend] AI-model keepalive disabled or missing config.");
    return stopAiModelKeepAliveLoop;
  }

  void runKeepAliveTick();
  keepAliveTimer = setInterval(() => {
    void runKeepAliveTick();
  }, BACKEND_AI_KEEPALIVE_INTERVAL_MS);

  // eslint-disable-next-line no-console
  console.log(
    `[backend] AI-model keepalive started (every ${Math.round(
      BACKEND_AI_KEEPALIVE_INTERVAL_MS / 1000
    )}s).`
  );

  return stopAiModelKeepAliveLoop;
};
