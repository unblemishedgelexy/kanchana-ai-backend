import { createSha256 } from "./crypto.js";

const readHeader = (headers, key) => {
  const value = headers?.[key];
  if (Array.isArray(value)) {
    return String(value[0] || "").trim();
  }

  return String(value || "").trim();
};

const parseCookieValue = (cookieHeader, cookieName) => {
  const source = String(cookieHeader || "");
  if (!source || !cookieName) {
    return "";
  }

  const pairs = source.split(";");
  for (const pair of pairs) {
    const [rawKey, ...rest] = pair.split("=");
    const key = String(rawKey || "").trim();
    if (key !== cookieName) {
      continue;
    }

    return decodeURIComponent(rest.join("=").trim());
  }

  return "";
};

const parseIpAddress = (req) => {
  const forwardedFor = readHeader(req.headers, "x-forwarded-for");
  if (forwardedFor) {
    const firstIp = forwardedFor
      .split(",")
      .map((item) => item.trim())
      .find(Boolean);
    if (firstIp) {
      return firstIp;
    }
  }

  return String(req.ip || req.socket?.remoteAddress || "unknown").trim();
};

const firstNonEmpty = (values = []) =>
  values
    .map((item) => String(item || "").trim())
    .find(Boolean) || "";

export const resolveGuestIdentity = (req) => {
  const ipAddress = parseIpAddress(req);
  const userAgent = readHeader(req.headers, "user-agent");
  const acceptLanguage = readHeader(req.headers, "accept-language");
  const cookieHeader = readHeader(req.headers, "cookie");

  const deviceId = firstNonEmpty([
    readHeader(req.headers, "x-device-id"),
    readHeader(req.headers, "x-client-device-id"),
    readHeader(req.headers, "x-client-id"),
    parseCookieValue(cookieHeader, "guest_device_id"),
    parseCookieValue(cookieHeader, "device_id"),
  ]);

  const sessionId = firstNonEmpty([
    readHeader(req.headers, "x-session-id"),
    parseCookieValue(cookieHeader, "guest_session_id"),
    parseCookieValue(cookieHeader, "session_id"),
  ]);

  const rawFingerprint = [
    `ip:${ipAddress || "unknown"}`,
    `ua:${userAgent || "unknown"}`,
    `lang:${acceptLanguage || "unknown"}`,
    `device:${deviceId || "none"}`,
    `session:${sessionId || "none"}`,
  ].join("|");

  const fingerprintHash = createSha256(rawFingerprint);

  return {
    fingerprintHash,
    guestUserId: `guest_${fingerprintHash.slice(0, 24)}`,
    rateLimitKey: `guest:${fingerprintHash}`,
    metadata: {
      ipHash: createSha256(ipAddress || "unknown"),
      deviceHash: deviceId ? createSha256(deviceId) : "",
      sessionHash: sessionId ? createSha256(sessionId) : "",
      userAgentHash: userAgent ? createSha256(userAgent) : "",
    },
  };
};
