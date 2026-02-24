import { app, connectDatabase } from "./app.js";
import { PORT } from "./config.js";

const startServer = async () => {
  await connectDatabase();

  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[backend] Server running on http://localhost:${PORT}`);
  });
};

startServer().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("[backend] Failed to start server.", error);
  process.exit(1);
});
