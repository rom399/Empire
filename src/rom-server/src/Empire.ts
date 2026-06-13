import * as http from "http";
import { Middleware, Route, RouteHandler } from "./types";
import { ILogger } from "./logging/ILogger";
import { ConsoleLogger } from "./logging/ConsoleLogger";
import { Context } from "./Context";


type RouteMatch = {
    matched: boolean;
    params: Record<string, string>;
};

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

private matchRoute(
    routePath: string,
    requestPath: string
): RouteMatch {

    const routeSegments =
        routePath.split("/").filter(Boolean);

    const requestSegments =
        requestPath.split("/").filter(Boolean);

    if (routeSegments.length !== requestSegments.length) {
        return {
            matched: false,
            params: {}
        };
    }

    const params: Record<string, string> = {};

    for (let i = 0; i < routeSegments.length; i++) {

        const routeSegment =
            routeSegments[i];

        const requestSegment =
            requestSegments[i];

        if (routeSegment.startsWith(":")) {

            const paramName =
                routeSegment.slice(1);

            params[paramName] =
                requestSegment;

            continue;
        }

        if (routeSegment !== requestSegment) {
            return {
                matched: false,
                params: {}
            };
        }
    }

    return {
        matched: true,
        params
    };
}

private handleRoute(
    req: http.IncomingMessage,
    res: http.ServerResponse
): void {

    const path =
        req.url?.split("?")[0] ?? "/";

    for (const route of this.routes) {

        if (route.method !== req.method) {
            continue;
        }

        const match =
            this.matchRoute(
                route.path,
                path
            );

        if (!match.matched) {
            continue;
        }

        const ctx =
            new Context(
                req,
                res,
                match.params
            );

        route.handler(ctx);

        return;
    }

    res.statusCode = 404;
    res.end("Route not found");
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
