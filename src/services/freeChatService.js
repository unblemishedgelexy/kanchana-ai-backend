import { FREE_CHAT_PROVIDER_ORDER } from "../config.js";
import { HttpError } from "../utils/http.js";
import { buildSystemInstruction } from "./systemInstruction.js";
import { generateGroqReply } from "./groqService.js";
import { generateExternalFreeReply } from "./kanchanaExternalService.js";

const DEFAULT_ERROR_MESSAGE = "AI response unavailable right now. Please retry in a moment.";
const SUPPORTED_FREE_PROVIDERS = ["groq", "kanchana_external"];

const emitDebug = (debug, level, stage, payload = {}) => {
  const log = debug?.[level];
  if (typeof log === "function") {
    log(stage, payload);
  }
};

const normalizeProviderOrder = (input = FREE_CHAT_PROVIDER_ORDER) => {
  const normalized = (Array.isArray(input) ? input : [])
    .map((item) => String(item || "").trim().toLowerCase())
    .filter((item) => SUPPORTED_FREE_PROVIDERS.includes(item));

  const deduped = Array.from(new Set(normalized));
  if (!deduped.length) {
    return [...SUPPORTED_FREE_PROVIDERS];
  }

  return deduped;
};

const shouldTryNextProvider = (error) => {
  const statusCode = Number(error?.statusCode || 503);
  if (statusCode === 400) {
    return false;
  }
  return true;
};

const toFailureItem = (provider, error) => ({
  provider,
  statusCode: Number(error?.statusCode || 503),
  reason: String(error?.details?.reason || error?.details?.code || ""),
  message: String(error?.message || "unknown_error"),
});

export const generateFreeTierReply = async ({
  user,
  mode,
  inputText,
  history = [],
  voiceMode = false,
  debug = null,
}) => {
  const safeInput = String(inputText || "").trim();
  if (!safeInput) {
    throw new HttpError(400, "Message text is required.");
  }

  const providers = normalizeProviderOrder();
  const failures = [];

  for (const provider of providers) {
    emitDebug(debug, "event", "free_provider_attempt_started", {
      provider,
      inputLength: safeInput.length,
      historyCount: Array.isArray(history) ? history.length : 0,
      voiceMode: Boolean(voiceMode),
    });

    try {
      if (provider === "groq") {
        const text = await generateGroqReply({
          user,
          mode,
          inputText: safeInput,
          history,
          voiceMode,
          debug,
        });
        return {
          text,
          provider,
        };
      }

      const systemPrompt = buildSystemInstruction({
        user,
        mode,
        memoryContext: [],
        history,
        currentInput: safeInput,
        providerName: "Kanchana External Chat API",
        voiceMode: Boolean(voiceMode),
        maxTokens: Boolean(voiceMode) ? 96 : 240,
        apiLimitsInfo: `provider_chain=${providers.join("->")}; active=kanchana_external`,
      });

      const text = await generateExternalFreeReply({
        message: safeInput,
        history,
        context: {
          mode,
          tier: user?.tier || "Free",
          voiceMode: Boolean(voiceMode),
          providerChain: providers,
        },
        systemPrompt,
        debug,
      });

      return {
        text,
        provider,
      };
    } catch (error) {
      failures.push(toFailureItem(provider, error));
      emitDebug(debug, "warn", "free_provider_attempt_failed", {
        provider,
        statusCode: Number(error?.statusCode || 503),
        reason: String(error?.details?.reason || error?.details?.code || ""),
        message: error?.message || "unknown_error",
      });

      if (!shouldTryNextProvider(error)) {
        throw error;
      }
    }
  }

  throw new HttpError(503, DEFAULT_ERROR_MESSAGE, {
    code: "AI_RESPONSE_UNAVAILABLE",
    provider: "free_provider_router",
    failures,
  });
};
