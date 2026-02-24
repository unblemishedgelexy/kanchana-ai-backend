import { asyncHandler } from "../utils/http.js";

export const health = asyncHandler(async (_req, res) => {
  return res.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

export const ping = asyncHandler(async (_req, res) => {
  return res.json({
    pong: true,
    timestamp: new Date().toISOString(),
  });
});
