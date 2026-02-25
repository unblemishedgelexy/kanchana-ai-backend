import crypto from "crypto";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
if (process.env.SKIP_DOTENV !== "true") {
  dotenv.config({ path: path.resolve(__dirname, "../.env") });
}

export const NODE_ENV = process.env.NODE_ENV || "development";
export const IS_PRODUCTION = NODE_ENV === "production";

const parseBooleanEnv = (value, fallback = false) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
};

const parseNumberEnv = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
};

const parseListEnv = (value, fallback = []) => {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return [...fallback];
  }

  return normalized
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
};

export const PORT = Number(process.env.PORT || 5000);
export const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:3000";
const configuredCorsOrigins = CORS_ORIGIN.split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const localDevOrigins = [
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
];

export const CORS_ORIGINS = Array.from(
  new Set([
    ...configuredCorsOrigins,
    ...(IS_PRODUCTION ? [] : localDevOrigins),
  ])
);

export const GUEST_MODE_MESSAGE_LIMIT = Number(process.env.GUEST_MODE_MESSAGE_LIMIT || 7);
export const FREE_MODE_MESSAGE_LIMIT = Number(
  process.env.FREE_MODE_MESSAGE_LIMIT || process.env.MAX_FREE_MESSAGES || 10
);
export const FREE_DAILY_VOICE_SECONDS = Number(process.env.FREE_DAILY_VOICE_SECONDS || 300);
export const DEFAULT_VOICE_MESSAGE_SECONDS = Number(process.env.DEFAULT_VOICE_MESSAGE_SECONDS || 60);
export const GUEST_CHAT_RATE_LIMIT_PER_MINUTE = Number(
  process.env.GUEST_CHAT_RATE_LIMIT_PER_MINUTE || 15
);
export const MAX_FREE_MESSAGES = FREE_MODE_MESSAGE_LIMIT;
export const TOKEN_TTL_DAYS = Number(process.env.TOKEN_TTL_DAYS || 30);
export const PASSWORD_RESET_TTL_MINUTES = Number(process.env.PASSWORD_RESET_TTL_MINUTES || 20);

export const GEMINI_CHAT_MODEL =
  process.env.GEMINI_CHAT_MODEL || process.env.GEMINI_MODEL || "gemini-2.0-flash";
export const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
export const GEMINI_EMBED_MODEL = process.env.GEMINI_EMBED_MODEL || "text-embedding-004";
export const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
export const GROQ_API_BASE_URL = process.env.GROQ_API_BASE_URL || "https://api.groq.com/openai/v1";
export const GROQ_CHAT_MODEL = process.env.GROQ_CHAT_MODEL || "llama-3.1-8b-instant";
export const FREE_CHAT_PROVIDER_ORDER = parseListEnv(process.env.FREE_CHAT_PROVIDER_ORDER, [
  "groq",
  "kanchana_external",
]);
export const KANCHANA_API_BASE_URL =
  process.env.KANCHANA_API_BASE_URL || "https://kanchana-ai-model.onrender.com";
export const APP_API_KEY = process.env.APP_API_KEY || process.env.KANCHANA_API_KEY || "";
export const APP_CLIENT_SECRET =
  process.env.APP_CLIENT_SECRET || process.env.KANCHANA_CLIENT_SECRET || "";

export const VALID_MODES = ["Lovely", "Horror", "Shayari", "Chill", "Possessive", "Naughty", "Mystic"];
export const VALID_TIERS = ["Free", "Premium"];
export const VALID_USER_ROLES = ["normal", "host"];

export const PAYPAL_MODE = process.env.PAYPAL_MODE === "live" ? "live" : "sandbox";
export const PAYPAL_BASE_URL =
  PAYPAL_MODE === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
export const PREMIUM_PRICE = Number(process.env.PREMIUM_PRICE || 1.49);
export const PREMIUM_CURRENCY = process.env.PREMIUM_CURRENCY || "USD";
export const PREMIUM_PAYPAL_PLAN_ID = process.env.PREMIUM_PAYPAL_PLAN_ID || "";
export const PAYPAL_WEBHOOK_SKIP_VERIFY = process.env.PAYPAL_WEBHOOK_SKIP_VERIFY === "true";
export const PAYPAL_WEBHOOK_TEST_SECRET = process.env.PAYPAL_WEBHOOK_TEST_SECRET || "";

const ENCRYPTION_KEY_SEED =
  process.env.ENCRYPTION_KEY || process.env.APP_SECRET || "kanchana-dev-secret";
export const ENCRYPTION_KEY = crypto.createHash("sha256").update(ENCRYPTION_KEY_SEED).digest();

export const PINECONE_API_KEY = process.env.PINECONE_API_KEY || "";
export const PINECONE_INDEX = process.env.PINECONE_INDEX || "";

export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
export const GOOGLE_OAUTH_REDIRECT_URI = process.env.GOOGLE_OAUTH_REDIRECT_URI || "";

export const IMAGEKIT_PUBLIC_KEY = process.env.IMAGEKIT_PUBLIC_KEY || "";
export const IMAGEKIT_PRIVATE_KEY = process.env.IMAGEKIT_PRIVATE_KEY || "";
export const IMAGEKIT_URL_ENDPOINT = process.env.IMAGEKIT_URL_ENDPOINT || "";

export const AI_DEBUG_LOGS = process.env.AI_DEBUG_LOGS === "true";
export const CHAT_DEBUG_LOGS =
  process.env.CHAT_DEBUG_LOGS === "true" ||
  (process.env.CHAT_DEBUG_LOGS !== "false" && NODE_ENV !== "production" && NODE_ENV !== "test");
export const BACKEND_AI_KEEPALIVE_ENABLED = parseBooleanEnv(
  process.env.BACKEND_AI_KEEPALIVE_ENABLED,
  true
);
export const BACKEND_AI_KEEPALIVE_INTERVAL_MS = Math.max(
  10_000,
  parseNumberEnv(process.env.BACKEND_AI_KEEPALIVE_INTERVAL_MS, 30_000)
);
export const BACKEND_AI_KEEPALIVE_HISTORY_LIMIT = Math.max(
  2,
  Math.min(12, parseNumberEnv(process.env.BACKEND_AI_KEEPALIVE_HISTORY_LIMIT, 6))
);
export const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
export const GOOGLE_AUTH_SUCCESS_REDIRECT =
  process.env.GOOGLE_AUTH_SUCCESS_REDIRECT || `${FRONTEND_URL}/auth/google/success`;
export const GOOGLE_AUTH_ERROR_REDIRECT =
  process.env.GOOGLE_AUTH_ERROR_REDIRECT || `${FRONTEND_URL}/auth/google/error`;
