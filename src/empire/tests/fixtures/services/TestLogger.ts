import { ILogger } from "../../../src/logging/ILogger";

/**
 * In-memory ILogger for tests. Records every call instead of writing to
 * the console, so tests can assert on what was logged without polluting
 * test output.
 */
export class TestLogger implements ILogger {

    public readonly infoMessages: string[] = [];
    public readonly warnMessages: string[] = [];
    public readonly debugMessages: string[] = [];
    public readonly errorMessages: string[] = [];
    public readonly errorCauses: unknown[] = [];

    public info(message: string): void {
        this.infoMessages.push(message);
    }

    public warn(message: string): void {
        this.warnMessages.push(message);
    }

    public debug(message: string): void {
        this.debugMessages.push(message);
    }

    public error(message: string, error?: unknown): void {
        this.errorMessages.push(message);
        this.errorCauses.push(error);
    }
}
