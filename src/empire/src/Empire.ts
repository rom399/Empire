import * as http from "http";
import { Middleware, RouteHandler } from "./types";
import { ILogger } from "./logging/ILogger";
import { ConsoleLogger } from "./logging/ConsoleLogger";
import { Context } from "./http/Context";
import { StaticFileHandler } from "./static/StaticFileHandler";
import { Router } from "./routing/Router";

export interface EmpireOptions {
  host: string;
  port: number;
  logger?: ILogger;
}

export class Empire {
  private readonly host: string;
  private readonly port: number;
  private readonly server: http.Server;

  private readonly _logger: ILogger;

  private readonly middlewares: Middleware[] = [];
  private readonly router: Router;

  constructor(options: EmpireOptions) {
    this.host = options.host;
    this.port = options.port;
    this._logger = options.logger ?? new ConsoleLogger();
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
    const ctx = new Context(req, res);
    let index = 0;

    const next = async (): Promise<void> => {
      const middleware = this.middlewares[index++];

      if (middleware) {
        await middleware(ctx, next);
        return;
      }

      await this.router.handle(req, res);
    };

    await next();
  }

  public use(middleware: Middleware): void {
    this.middlewares.push(middleware);
  }

  public useStaticFiles(root: string): void {

    const handler = new StaticFileHandler({ root });

    const middleware: Middleware = async (ctx, next) => {

      const wasHandled = await handler.handle(ctx);

      if (!wasHandled) {
        await next();
      }
    };

    this.use(middleware);
  }

  public get(path: string, handler: RouteHandler): void {
    this.router.get(path, handler);
  }

  public post(path: string, handler: RouteHandler): void {
    this.router.post(path, handler);
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
