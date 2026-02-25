import { app, connectDatabase } from "./app.js";
import { PORT } from "./config.js";
import { startAiModelKeepAliveLoop } from "./services/aiModelKeepAliveService.js";

const startServer = async () => {
  await connectDatabase();
  const stopKeepAlive = startAiModelKeepAliveLoop();

  const server = app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[backend] Server running on http://localhost:${PORT}`);
  });

  const shutdown = () => {
    stopKeepAlive();
    server.close(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
};

startServer().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("[backend] Failed to start server.", error);
  process.exit(1);
});
