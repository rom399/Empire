
import * as http from "http";


export interface EmpireOptions {
    host: string;
    port: number;
}

export class Empire {

    private readonly host: string;
    private readonly port: number;
    private readonly server: http.Server | null = null;
    
    constructor(options: EmpireOptions) {
        this.host = options.host;
        this.port = options.port;
        this.server = http.createServer(
            (req: http.IncomingMessage, res: http.ServerResponse) => {
                this.handleRequest(req, res);
            }
        );
    }

    private handleRequest(req: http.IncomingMessage, res: http.ServerResponse) : void {
            console.log(`${req.method} ${req.url}`);

            res.statusCode = 200;
            res.setHeader("Content-Type", "text/plain");
            res.end("Welcome to Empire");
    }

    public start() : Promise<void> {
        return new Promise((resolve, reject) => {
            this.server?.listen(this.port, this.host, () => {
                console.log(`Empire server running at http://${this.host}:${this.port}/`);
                resolve();
            });
        });
    }

    public stop() : void {
        this.server?.close(() => {
            console.log("Empire server stopped.");
        });
    }
}