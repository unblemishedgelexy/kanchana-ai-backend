import express from "express";
import mongoose from "mongoose";
import { CORS_ORIGINS } from "./config.js";
import { securityHeadersMiddleware } from "./middleware/security.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandlers.js";
import authRoutes from "./routes/authRoutes.js";
import contentRoutes from "./routes/contentRoutes.js";
import chatRoutes from "./routes/chatRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import systemRoutes from "./routes/systemRoutes.js";
import mediaRoutes from "./routes/mediaRoutes.js";

const app = express();
app.set("trust proxy", 1);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || CORS_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin || CORS_ORIGINS[0] || "*");
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  return next();
});

app.use(securityHeadersMiddleware);
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: false }));

app.use("/api", systemRoutes);

app.use("/api/auth", authRoutes);
app.use("/api/content", contentRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/media", mediaRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export const connectDatabase = async () => {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    // eslint-disable-next-line no-console
    console.log("[backend] MONGODB_URI not set, using in-memory store.");
    return;
  }

  try {
    await mongoose.connect(mongoUri);
    // eslint-disable-next-line no-console
    console.log("[backend] Connected to MongoDB.");
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[backend] MongoDB connection failed, using in-memory store.", error.message);
  }
};

export { app };
