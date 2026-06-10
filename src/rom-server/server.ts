import process from "process";
import { Empire } from "./src/Empire";

async function main() {
  const app = new Empire({
    host: "localhost",
    port: 8008,
  });

  //app.use(logger);
  //app.use(auth);

  try {
    await app.start();
  } catch (err) {
    app.logger.error("Failed to start server", err);

    process.exit(1);
  }

  process.on("SIGINT", async () => {
    app.logger.info("Stopping server...");

    try {
      await app.stop();
      app.logger.info("Server stopped successfully.");
      process.exit(0);
    } catch (err) {
      app.logger.error("Error stopping server:", err);
      process.exit(1);
    }
  });
}

main().catch((err) => {
  console.error("Unexpected startup failure:", err);
  process.exit(1);
});
