import process from "process";
import { Empire } from "./src/Empire";

async function main() {
  const app = new Empire({
    host: "localhost",
    port: 8008
  });

  //app.use(logger);
  //app.use(auth);

  await app.start();

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
  app.logger.error("Error starting server:", err);
  process.exit(1);
});
