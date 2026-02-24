import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import User from "../models/User.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const run = async () => {
  const mongoUri = String(process.env.MONGODB_URI || "").trim();
  if (!mongoUri) {
    throw new Error("MONGODB_URI is required to run this migration.");
  }

  await mongoose.connect(mongoUri);

  const updates = [];

  updates.push(
    await User.updateMany(
      {
        isHost: true,
        role: { $ne: "host" },
      },
      {
        $set: { role: "host" },
      }
    )
  );

  updates.push(
    await User.updateMany(
      {
        role: "host",
        isHost: { $ne: true },
      },
      {
        $set: { isHost: true },
      }
    )
  );

  updates.push(
    await User.updateMany(
      {
        role: { $exists: false },
        isHost: true,
      },
      {
        $set: { role: "host" },
      }
    )
  );

  updates.push(
    await User.updateMany(
      {
        role: { $exists: false },
        $or: [{ isHost: false }, { isHost: { $exists: false } }],
      },
      {
        $set: { role: "normal" },
      }
    )
  );

  updates.push(
    await User.updateMany(
      {
        isHost: { $exists: false },
        role: "host",
      },
      {
        $set: { isHost: true },
      }
    )
  );

  updates.push(
    await User.updateMany(
      {
        isHost: { $exists: false },
        role: { $ne: "host" },
      },
      {
        $set: { isHost: false },
      }
    )
  );

  updates.push(
    await User.updateMany(
      {
        modeMessageCounts: { $exists: false },
      },
      {
        $set: { modeMessageCounts: {} },
      }
    )
  );

  updates.push(
    await User.updateMany(
      {
        voiceUsage: { $exists: false },
      },
      {
        $set: {
          voiceUsage: {
            dateKey: "",
            secondsUsed: 0,
          },
        },
      }
    )
  );

  const modified = updates.reduce((total, result) => total + Number(result.modifiedCount || 0), 0);
  // eslint-disable-next-line no-console
  console.log(`[migration] Completed 20260224-add-role-and-usage-fields. Modified: ${modified}`);

  await mongoose.disconnect();
};

run().catch(async (error) => {
  // eslint-disable-next-line no-console
  console.error("[migration] Failed:", error);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore disconnect failure
  }
  process.exitCode = 1;
});
