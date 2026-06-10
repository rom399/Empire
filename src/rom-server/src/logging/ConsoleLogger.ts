import { ILogger } from "./ILogger";

export class ConsoleLogger implements ILogger {
  private write(level: string, message: string, error?: Error): void {
    const timestamp = new Date().toISOString();
    if (error) {
      console.error(`[${timestamp}][${level}] ${message}`, error);
    } else {
      console.log(`[${timestamp}][${level}] ${message}`);
    }
  }

  public info(message: string): void {
    this.write("[INFO]", message);
  }

  public warn(message: string): void {
    this.write("[WARN]", message);
  }

  public error(message: string, error?: Error): void {
    this.write("[ERROR]", message, error);
  }

  public debug(message: string): void {
    this.write("[DEBUG]", message);
  }
}
