import * as http from "http";
import * as path from "path";
import { Middleware, RouteHandler } from "./types";
import { ILogger } from "./logging/ILogger";
import { ConsoleLogger } from "./logging/ConsoleLogger";
import { Context } from "./http/Context";
import { sendErrorResponse } from "./errors/sendErrorResponse";
import { StaticFileHandler } from "./static/StaticFileHandler";
import { UseStaticFilesOptions } from "./static/UseStaticFilesOptions";
import { Router } from "./routing/Router";
import { ServiceProvider } from "./di/ServiceProvider";

export interface EmpireOptions {
  host: string;
  port: number;
  logger?: ILogger;
  maxBodySize?: number;
  services?: ServiceProvider;
  shutdownTimeoutMs?: number;
}

export class Empire {
  private static readonly DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

  private readonly host: string;
  private readonly port: number;
  private readonly server: http.Server;

  private readonly _logger: ILogger;
  private readonly maxBodySize?: number;
  private readonly _services?: ServiceProvider;
  private readonly shutdownTimeoutMs: number;

  private readonly middlewares: Middleware[] = [];
  private readonly router: Router;

  constructor(options: EmpireOptions) {
    this.host = options.host;
    this.port = options.port;
    this._logger = options.logger ?? new ConsoleLogger();
    this.maxBodySize = options.maxBodySize;
    this._services = options.services;
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? Empire.DEFAULT_SHUTDOWN_TIMEOUT_MS;
    this.router = new Router(this._logger);

    this.server = http.createServer(
      async (req: http.IncomingMessage, res: http.ServerResponse) => {
        await this.handleRequest(req, res);
      },
    );
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const scope = this._services?.createScope();
    const ctx = new Context(req, res, {}, this.maxBodySize, scope);

    if (scope) {
      // Whichever fires first - dispose() is idempotent, so registering
      // both is just belt-and-suspenders against a client that disconnects
      // before "finish" would otherwise fire.
      const disposeScope = (): void => {
        scope.dispose().catch((err) => {
          this._logger.error("Error disposing request scope", err);
        });
      };
      res.once("finish", disposeScope);
      res.once("close", disposeScope);
    }

    const dispatch = async (index: number): Promise<void> => {
      const middleware = this.middlewares[index];

      if (!middleware) {
        await this.router.handle(req, res, ctx);
        return;
      }

      let nextCalled = false;

      await middleware(ctx, async () => {
        if (nextCalled) {
          throw new Error("next() called multiple times");
        }
        nextCalled = true;

        await dispatch(index + 1);
      });
    };

    try {
      await dispatch(0);
    } catch (err) {
      sendErrorResponse(res, err, this._logger, "Unhandled middleware error");
    }
  }

  public use(middleware: Middleware): void {
    this.middlewares.push(middleware);
  }

  /**
   * Serves static files from root. Pass options.prefix to mount the
   * folder under a URL prefix instead of the URL root — useful when
   * serving more than one static folder from the same server. Pass
   * options.spaFallback to serve root/index.html for any request that
   * matches neither a static file nor a registered route, so a
   * client-side router can render the path itself.
   */
  public useStaticFiles(root: string, options?: UseStaticFilesOptions): void {

    const handler = new StaticFileHandler({ root, prefix: options?.prefix });

    const middleware: Middleware = async (ctx, next) => {

      const wasHandled = await handler.handle(ctx);

      if (!wasHandled) {
        await next();
      }
    };

    this.use(middleware);

    if (options?.spaFallback) {
      const indexPath = path.join(root, "index.html");

      this.router.setFallback(async (ctx) => {
        await ctx.file(indexPath);
      });
    }
  }

  public get(path: string, handler: RouteHandler): void {
    this.router.get(path, handler);
  }

  public post(path: string, handler: RouteHandler): void {
    this.router.post(path, handler);
  }

  public put(path: string, handler: RouteHandler): void {
    this.router.put(path, handler);
  }

  public patch(path: string, handler: RouteHandler): void {
    this.router.patch(path, handler);
  }

  public delete(path: string, handler: RouteHandler): void {
    this.router.delete(path, handler);
  }

  public options(path: string, handler: RouteHandler): void {
    this.router.options(path, handler);
  }

  public get logger(): ILogger {
    return this._logger;
  }

  /**
   * The root ServiceProvider passed via EmpireOptions.services, if any.
   * Undefined when the app was constructed without it - dependency
   * injection is entirely opt-in.
   */
  public get services(): ServiceProvider | undefined {
    return this._services;
  }

  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.once("error", (err) => {
        reject(err);
      });

      this.server.listen(this.port, this.host, () => {
        this._logger.info(
          `Empire server running at http://${this.host}:${this.port}/`,
        );
        resolve();
      });
    });
  }

  /**
   * Stops accepting new connections, lets in-flight requests finish, then
   * disposes any singletons registered via EmpireOptions.services. Idle
   * keep-alive sockets are closed immediately, since they aren't serving
   * anything - real in-flight requests get up to shutdownTimeoutMs
   * (default 10s) to finish naturally before remaining connections are
   * force-closed. Disposal is attempted either way, and any error the
   * server itself reports still rejects the returned promise, but only
   * after disposal has run - a close error shouldn't skip cleanup.
   *
   * This does not register SIGTERM/SIGINT handlers itself - call it from
   * your own signal handler, as every example in examples/ does. Empire
   * doesn't wire this up automatically because it would mean every
   * constructed instance registers process-wide listeners, which is
   * exactly the kind of surprising global side effect a library
   * constructor shouldn't have - especially with many short-lived
   * instances, as in this project's own test suite.
   */
  public async stop(): Promise<void> {
    this.server.closeIdleConnections();

    let closeError: unknown;

    const closed = new Promise<void>((resolve) => {
      this.server.close((err) => {
        if (err) {
          closeError = err;
        }
        resolve();
      });
    });

    const timedOut = new Promise<"timeout">((resolve) => {
      setTimeout(() => resolve("timeout"), this.shutdownTimeoutMs);
    });

    const outcome = await Promise.race([
      closed.then(() => "closed" as const),
      timedOut,
    ]);

    if (outcome === "timeout") {
      this._logger.error(
        `Shutdown timed out after ${this.shutdownTimeoutMs}ms - forcing remaining connections closed`,
      );
      this.server.closeAllConnections();
      await closed;
    }

    await this._services?.dispose();

    if (closeError) {
      throw closeError;
    }
  }
}
