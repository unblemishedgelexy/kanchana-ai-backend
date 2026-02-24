import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    provider: {
      type: String,
      enum: ["paypal"],
      required: true,
    },
    flow: {
      type: String,
      enum: ["order", "subscription"],
      required: true,
    },
    providerRef: {
      type: String,
      required: true,
      index: true,
    },
    status: {
      type: String,
      default: "CREATED",
      index: true,
    },
    amount: {
      type: Number,
      default: 0,
    },
    currency: {
      type: String,
      default: "INR",
    },
    metadataCipherText: {
      type: String,
      default: "",
    },
    metadataIv: {
      type: String,
      default: "",
    },
    metadataAuthTag: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

const Payment = mongoose.model("Payment", paymentSchema);

export default Payment;
