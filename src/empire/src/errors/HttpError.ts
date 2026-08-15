import { HttpErrorOptions } from "./HttpErrorOptions";

export class HttpError extends Error {

    public readonly statusCode: number;
    public readonly code?: string;
    public readonly retryable?: boolean;

    constructor(
        statusCode: number,
        message: string,
        options?: HttpErrorOptions
    ) {
        super(message);

        this.name = this.constructor.name;
        this.statusCode = statusCode;
        this.code = options?.code;
        this.retryable = options?.retryable;
    }
}
