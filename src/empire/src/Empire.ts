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

export interface EmpireOptions {
  host: string;
  port: number;
  logger?: ILogger;
  maxBodySize?: number;
}

export class Empire {
  private readonly host: string;
  private readonly port: number;
  private readonly server: http.Server;

  private readonly _logger: ILogger;
  private readonly maxBodySize?: number;

  private readonly middlewares: Middleware[] = [];
  private readonly router: Router;

  constructor(options: EmpireOptions) {
    this.host = options.host;
    this.port = options.port;
    this._logger = options.logger ?? new ConsoleLogger();
    this.maxBodySize = options.maxBodySize;
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
    const ctx = new Context(req, res, {}, this.maxBodySize);

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

  public stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }
}
