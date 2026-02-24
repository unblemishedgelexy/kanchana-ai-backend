import { DEFAULT_VOICE_MESSAGE_SECONDS, VALID_MODES } from "../../config.js";
import { HttpError } from "../../utils/http.js";

const BOOLEAN_TRUE_VALUES = new Set(["true", "1", "yes"]);
const BOOLEAN_FALSE_VALUES = new Set(["false", "0", "no"]);

const createValidationError = (message, code) => {
  const error = new HttpError(400, message);
  error.code = code;
  return error;
};

export const parseVoiceMode = (value) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
    return null;
  }

  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (BOOLEAN_TRUE_VALUES.has(normalized)) {
    return true;
  }

  if (BOOLEAN_FALSE_VALUES.has(normalized)) {
    return false;
  }

  return null;
};

const parseVoiceDurationSeconds = (value) => {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_VOICE_MESSAGE_SECONDS;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.floor(parsed);
};

const validateMode = (mode) => {
  const safeMode = String(mode || "").trim();
  if (!safeMode) {
    return "";
  }

  if (!VALID_MODES.includes(safeMode)) {
    throw createValidationError("Invalid mode.", "INVALID_MODE");
  }

  return safeMode;
};

export const validateChatMessageRequest = (req, _res, next) => {
  try {
    const safeMode = validateMode(req.body?.mode);
    if (safeMode) {
      req.body.mode = safeMode;
    }

    const normalizedVoiceMode = parseVoiceMode(req.body?.voiceMode);
    if (normalizedVoiceMode === null) {
      throw createValidationError("voiceMode must be a boolean value.", "INVALID_VOICE_MODE");
    }
    req.body.voiceMode = normalizedVoiceMode;

    const voiceDurationSeconds = parseVoiceDurationSeconds(req.body?.voiceDurationSeconds);
    if (
      voiceDurationSeconds === null ||
      voiceDurationSeconds < 1 ||
      voiceDurationSeconds > 600
    ) {
      throw createValidationError(
        "voiceDurationSeconds must be between 1 and 600.",
        "INVALID_VOICE_DURATION"
      );
    }

    req.body.voiceDurationSeconds = voiceDurationSeconds;
    return next();
  } catch (error) {
    return next(error);
  }
};

export const validateChatModeQuery = (req, _res, next) => {
  try {
    const safeMode = validateMode(req.query?.mode);
    if (safeMode) {
      req.query.mode = safeMode;
    }
    return next();
  } catch (error) {
    return next(error);
  }
};

export const validateChatModeMutation = (req, _res, next) => {
  try {
    const queryMode = validateMode(req.query?.mode);
    if (queryMode) {
      req.query.mode = queryMode;
    }

    const bodyMode = validateMode(req.body?.mode);
    if (bodyMode) {
      req.body.mode = bodyMode;
    }

    return next();
  } catch (error) {
    return next(error);
  }
};
