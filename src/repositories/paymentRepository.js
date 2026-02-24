import mongoose from "mongoose";
import Payment from "../models/Payment.js";
import { memoryStore, createMemoryPaymentId } from "../data/memoryStore.js";

const isMongoConnected = () => mongoose.connection.readyState === 1;

export const create = async ({
  userId,
  provider,
  flow,
  providerRef,
  status = "CREATED",
  amount = 0,
  currency = "INR",
  metadataCipherText = "",
  metadataIv = "",
  metadataAuthTag = "",
}) => {
  if (isMongoConnected()) {
    return Payment.create({
      userId: String(userId),
      provider,
      flow,
      providerRef,
      status,
      amount,
      currency,
      metadataCipherText,
      metadataIv,
      metadataAuthTag,
    });
  }

  const payment = {
    id: createMemoryPaymentId(),
    userId: String(userId),
    provider,
    flow,
    providerRef,
    status,
    amount,
    currency,
    metadataCipherText,
    metadataIv,
    metadataAuthTag,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  memoryStore.payments.push(payment);
  return payment;
};

export const findByProviderRef = async (providerRef) => {
  const normalizedRef = String(providerRef || "").trim();
  if (!normalizedRef) {
    return null;
  }

  if (isMongoConnected()) {
    return Payment.findOne({ providerRef: normalizedRef });
  }

  return memoryStore.payments.find((payment) => payment.providerRef === normalizedRef) || null;
};

export const findLatestByUserId = async (userId) => {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) {
    return null;
  }

  if (isMongoConnected()) {
    return Payment.findOne({ userId: normalizedUserId }).sort({ createdAt: -1, _id: -1 });
  }

  return (
    memoryStore.payments
      .filter((payment) => String(payment.userId || "") === normalizedUserId)
      .sort((left, right) => {
        const leftTime = new Date(left?.createdAt || 0).getTime();
        const rightTime = new Date(right?.createdAt || 0).getTime();
        return rightTime - leftTime;
      })[0] || null
  );
};

export const save = async (payment) => {
  if (!payment) {
    return null;
  }

  if (isMongoConnected()) {
    return payment.save();
  }

  payment.updatedAt = new Date();
  return payment;
};
