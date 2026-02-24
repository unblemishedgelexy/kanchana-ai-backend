import { HttpError } from "../utils/http.js";

const limiterStores = new Set();

const buildKey = (req) => req.ip || req.headers["x-forwarded-for"] || "anonymous";

export const createRateLimiter = ({ windowMs, max, message, code = "", keyResolver = null, skip = null }) => {
  const safeWindow = Math.max(1000, Number(windowMs || 60_000));
  const safeMax = Math.max(1, Number(max || 60));
  const safeMessage = message || "Too many requests. Please retry later.";
  const resolveKey = typeof keyResolver === "function" ? keyResolver : buildKey;
  const shouldSkip = typeof skip === "function" ? skip : () => false;
  const store = new Map();
  limiterStores.add(store);

  return (req, _res, next) => {
    if (shouldSkip(req)) {
      return next();
    }

    const key = String(resolveKey(req) || "anonymous");
    const now = Date.now();
    const record = store.get(key);

    if (!record || record.expiresAt <= now) {
      store.set(key, {
        count: 1,
        expiresAt: now + safeWindow,
      });
      return next();
    }

    if (record.count >= safeMax) {
      const error = new HttpError(429, safeMessage, {
        retryAfterMs: Math.max(0, record.expiresAt - now),
      });
      if (code) {
        error.code = code;
      }
      return next(error);
    }

    record.count += 1;
    store.set(key, record);
    return next();
  };
};

export const resetRateLimitStore = () => {
  limiterStores.forEach((store) => store.clear());
};
