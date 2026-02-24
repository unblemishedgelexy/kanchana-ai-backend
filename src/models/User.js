import mongoose from "mongoose";
import { VALID_MODES, VALID_TIERS } from "../config.js";

const sessionSchema = new mongoose.Schema(
  {
    tokenHash: {
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    userAgent: {
      type: String,
      default: "",
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      default: "",
    },
    googleSub: {
      type: String,
      default: "",
      index: true,
    },
    tier: {
      type: String,
      enum: VALID_TIERS,
      default: "Free",
    },
    preferredMode: {
      type: String,
      enum: VALID_MODES,
      default: "Lovely",
    },
    messageCount: {
      type: Number,
      default: 0,
    },
    profileImageUrl: {
      type: String,
      default: "",
    },
    upgradeAssetUrl: {
      type: String,
      default: "",
    },
    activeTokens: {
      type: [sessionSchema],
      default: [],
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

userSchema.index({ "activeTokens.tokenHash": 1 });

const User = mongoose.model("User", userSchema);

export default User;
