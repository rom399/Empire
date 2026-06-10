import * as http from "http";
import { Middleware } from "./types";
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
        };

        res.statusCode = 200;
        res.setHeader("Content-Type", "text/plain");
        res.end("Welcome to Empire");
    };
    next();
  }

  public use(middleware: Middleware): void {
    this.middlewares.push(middleware);
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
        this.logger.info(
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
