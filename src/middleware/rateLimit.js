import { HttpError } from "../utils/http.js";

const stores = new Map();

const buildKey = (req) => req.ip || req.headers["x-forwarded-for"] || "anonymous";

export const createRateLimiter = ({ windowMs, max, message }) => {
  const safeWindow = Math.max(1000, Number(windowMs || 60_000));
  const safeMax = Math.max(1, Number(max || 60));
  const safeMessage = message || "Too many requests. Please retry later.";

  return (req, _res, next) => {
    const key = buildKey(req);
    const now = Date.now();
    const record = stores.get(key);

    if (!record || record.expiresAt <= now) {
      stores.set(key, {
        count: 1,
        expiresAt: now + safeWindow,
      });
      return next();
    }

    if (record.count >= safeMax) {
      return next(new HttpError(429, safeMessage));
    }

    record.count += 1;
    stores.set(key, record);
    return next();
  };
};

export const resetRateLimitStore = () => {
  stores.clear();
};
