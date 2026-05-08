import { redactSecrets } from "./redact.js";

export interface SafeLogSink {
  log(message?: unknown, ...optionalParams: unknown[]): void;
  warn(message?: unknown, ...optionalParams: unknown[]): void;
  error(message?: unknown, ...optionalParams: unknown[]): void;
}

export class SafeLogger {
  constructor(private readonly sink: SafeLogSink = console) {}

  info(message: unknown, ...optionalParams: unknown[]): void {
    this.sink.log(this.redact(message), ...optionalParams.map((param) => this.redact(param)));
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.sink.warn(this.redact(message), ...optionalParams.map((param) => this.redact(param)));
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.sink.error(this.redact(message), ...optionalParams.map((param) => this.redact(param)));
  }

  private redact(value: unknown): string {
    return redactSecrets(value);
  }
}
