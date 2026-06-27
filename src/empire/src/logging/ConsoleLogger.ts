import { ILogger } from "./ILogger";

export class ConsoleLogger implements ILogger {
  private write(level: string, message: string): void {
    const timestamp = new Date().toISOString();

    if (level === "[ERROR]") {
      console.error(`[${timestamp}]${level} ${message}`);
    } else {
      console.log(`[${timestamp}]${level} ${message}`);
    }
  }

  private formatMessage(message: unknown): string {
    if (message instanceof Error) {
      return message.stack || message.message;
    } else {
      return String(message);
    }
  }

  public info(message: string): void {
    this.write("[INFO]", message);
  }

  public warn(message: string): void {
    this.write("[WARN]", message);
  }

  public debug(message: string): void {
    this.write("[DEBUG]", message);
  }

  public error(message: string, error?: unknown): void {
    const formatted = this.formatMessage(error);

    this.write("[ERROR]", formatted ? `${message}\n${formatted}` : message);
  }
}
