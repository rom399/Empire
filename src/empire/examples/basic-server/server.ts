import process from "process";
import { Empire } from "../../src/Empire";
import { logger } from "../../src/middleware/LoggerMiddleware";
import { auth } from "../../src/middleware/AuthMiddleware";

async function main() {
  const app = new Empire({
    host: "localhost",
    port: 8008,
  });

  app.use(logger);
  app.use(auth);

  app.get("/test/page", (ctx) => {
    const page =
      ctx.query.get("page");

    ctx.html(`
        <html>
            <body>
                <h1>Empire</h1>
                <p>Page = ${page}</p>
            </body>
        </html>
    `);
  });

  app.get("/", (ctx) => {
    ctx.html(`
        <!DOCTYPE html>
        <html>
            <head>
                <title>Empire</title>
            </head>
            <body>
                <h1>Empire is running</h1>
                <p>Hello from ctx.html()</p>
            </body>
        </html>
    `);
  });

  app.get("/health", (ctx) => {
    ctx.json({
      status: "OK",
      framework: "Empire"
    });
  });

  app.get("/query", (ctx) => {
    const page = ctx.query.get("page") ?? "not supplied";

    ctx.json({
      page
    });
  });


  app.get("/users/:id", (ctx) => {

    ctx.json({
      id: ctx.params.id
    });

  });

  app.post("/users", async (ctx) => {

    const user = await ctx.jsonBody();

  });

  app.post("/json", async (ctx) => {

    const body = await ctx.jsonBody();

    ctx.json(body);

  });


  app.get("/form", (ctx) => {
    ctx.html(`
        <!DOCTYPE html>
        <html>
            <body>
                <h1>User Form</h1>

                <form method="post" action="/users">
                    <input
                        type="text"
                        name="name"
                        placeholder="Name"
                    />

                    <button type="submit">
                        Submit
                    </button>
                </form>
            </body>
        </html>
    `);
  });


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
