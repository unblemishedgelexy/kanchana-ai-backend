import mongoose from "mongoose";
import { VALID_MODES } from "../config.js";

const messageSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    mode: {
      type: String,
      enum: VALID_MODES,
      required: true,
    },
    role: {
      type: String,
      enum: ["user", "kanchana"],
      required: true,
    },
    cipherText: {
      type: String,
      required: true,
    },
    iv: {
      type: String,
      required: true,
    },
    authTag: {
      type: String,
      required: true,
    },
    contentHash: {
      type: String,
      required: true,
      index: true,
    },
    vectorId: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

messageSchema.index({ userId: 1, mode: 1, createdAt: -1 });

const Message = mongoose.model("Message", messageSchema);

export default Message;
