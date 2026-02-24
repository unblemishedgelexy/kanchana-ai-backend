import mongoose from "mongoose";
import { VALID_MODES } from "../config.js";

const guestUsageSchema = new mongoose.Schema(
  {
    fingerprintHash: {
      type: String,
      required: true,
      index: true,
    },
    mode: {
      type: String,
      enum: VALID_MODES,
      required: true,
    },
    messageCount: {
      type: Number,
      default: 0,
    },
    voiceUsageDateKey: {
      type: String,
      default: "",
    },
    voiceSecondsUsed: {
      type: Number,
      default: 0,
    },
    ipHash: {
      type: String,
      default: "",
    },
    deviceHash: {
      type: String,
      default: "",
    },
    sessionHash: {
      type: String,
      default: "",
    },
    userAgentHash: {
      type: String,
      default: "",
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

guestUsageSchema.index({ fingerprintHash: 1, mode: 1 }, { unique: true });

const GuestUsage = mongoose.model("GuestUsage", guestUsageSchema);

export default GuestUsage;
