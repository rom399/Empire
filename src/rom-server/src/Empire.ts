import * as http from "http";
import { Middleware, Route, RouteHandler } from "./types";
import { ILogger } from "./logging/ILogger";
import { ConsoleLogger } from "./logging/ConsoleLogger";

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
  private readonly routes: Route[] = [];

  constructor(options: EmpireOptions) {
    this.host = options.host;
    this.port = options.port;
    this._logger = options.logger ?? new ConsoleLogger();

    this.server = http.createServer(
      (req: http.IncomingMessage, res: http.ServerResponse) => {
        this.handleRequest(req, res);
      },
    );
  }

private handleRoute(
    req: http.IncomingMessage,
    res: http.ServerResponse
): void {

    const path =
        req.url?.split("?")[0] ?? "/";

    const route =
        this.routes.find(r =>
            r.method === req.method &&
            r.path === path
        );

    if (!route) {
        res.statusCode = 404;
        res.end("Route not found");
        return;
    }

    route.handler(req, res);
}


  private handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    let index = 0;

    const next = (): void => {
      const middleware = this.middlewares[index++];

      if (middleware) {
        middleware(req, res, next);
        return;
      }

    this.handleRoute(req, res);
    };
    next();
  }

  public use(middleware: Middleware): void {
    this.middlewares.push(middleware);
  }

  public get(path: string, handler: RouteHandler): void {
    this.routes.push({
      method: "GET",
      path,
      handler,
    });
  }

  public post(path: string, handler: RouteHandler): void {
    this.routes.push({
      method: "POST",
      path,
      handler,
    });
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
