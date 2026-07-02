import { formatLogEntry } from './format';
import { getLevelValue } from './levels';
import type { LogLevel } from './types';

export interface ErrorReporterPayload {
  message: string;
  meta: unknown;
  environment: string;
  correlationId: string | undefined;
  baseMeta: Record<string, unknown>;
  getLogMetadata: () => Record<string, unknown>;
}

export type ErrorReporter = (payload: ErrorReporterPayload) => void;

export type { LogLevel };

export interface Logger {
  debug(_message: string, _meta?: unknown): void;
  info(_message: string, _meta?: unknown): void;
  warn(_message: string, _meta?: unknown): void;
  error(_message: string, _meta?: unknown): void;
}

export interface StructuredLoggerOptions {
  environment: string;
  level?: LogLevel;
  baseMeta?: Record<string, unknown>;
  getCorrelationId?: () => string | undefined;
  getLogMetadata?: () => Record<string, unknown>;
  errorReporter?: ErrorReporter;
}

export class ConsoleLogger implements Logger {
  private level: LogLevel;
  private environment: string;
  private baseMeta: Record<string, unknown>;
  private readonly getCorrelationId: () => string | undefined;
  private readonly getLogMetadata: () => Record<string, unknown>;
  private readonly errorReporter: ErrorReporter | undefined;

  constructor(options: StructuredLoggerOptions) {
    const {
      level = 'info',
      environment,
      baseMeta = {},
      getCorrelationId,
      getLogMetadata,
      errorReporter,
    } = options;
    if (!['debug', 'info', 'warn', 'error'].includes(level)) {
      throw new Error(`Unexpected value: ${String(level)}`);
    }
    this.level = level;
    this.environment = environment;
    this.baseMeta = baseMeta;
    this.getCorrelationId = getCorrelationId ?? (() => undefined);
    this.getLogMetadata = getLogMetadata ?? (() => ({}));
    this.errorReporter = errorReporter;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  with(additionalMeta: Record<string, unknown>): ConsoleLogger {
    return new ConsoleLogger({
      environment: this.environment,
      level: this.level,
      baseMeta: { ...this.baseMeta, ...additionalMeta },
      getCorrelationId: this.getCorrelationId,
      getLogMetadata: this.getLogMetadata,
      ...(this.errorReporter ? { errorReporter: this.errorReporter } : {}),
    });
  }

  debug(message: string, meta?: unknown): void {
    if (getLevelValue('debug') >= getLevelValue(this.level)) {
      this.writeLog(
        'debug',
        formatLogEntry({
          level: 'debug',
          message,
          meta,
          environment: this.environment,
          nodeVersion: typeof process !== 'undefined' ? process.version : 'browser',
          correlationId: this.getCorrelationId(),
          baseMeta: this.baseMeta,
          getLogMetadata: this.getLogMetadata,
        })
      );
    }
  }

  info(message: string, meta?: unknown): void {
    if (getLevelValue('info') >= getLevelValue(this.level)) {
      this.writeLog(
        'info',
        formatLogEntry({
          level: 'info',
          message,
          meta,
          environment: this.environment,
          nodeVersion: typeof process !== 'undefined' ? process.version : 'browser',
          correlationId: this.getCorrelationId(),
          baseMeta: this.baseMeta,
          getLogMetadata: this.getLogMetadata,
        })
      );
    }
  }

  warn(message: string, meta?: unknown): void {
    if (getLevelValue('warn') >= getLevelValue(this.level)) {
      this.writeLog(
        'warn',
        formatLogEntry({
          level: 'warn',
          message,
          meta,
          environment: this.environment,
          nodeVersion: typeof process !== 'undefined' ? process.version : 'browser',
          correlationId: this.getCorrelationId(),
          baseMeta: this.baseMeta,
          getLogMetadata: this.getLogMetadata,
        })
      );
    }
  }

  error(message: string, meta?: unknown): void {
    if (getLevelValue('error') >= getLevelValue(this.level)) {
      this.writeLog(
        'error',
        formatLogEntry({
          level: 'error',
          message,
          meta,
          environment: this.environment,
          nodeVersion: typeof process !== 'undefined' ? process.version : 'browser',
          correlationId: this.getCorrelationId(),
          baseMeta: this.baseMeta,
          getLogMetadata: this.getLogMetadata,
        })
      );
    }

    if (this.errorReporter) {
      this.errorReporter({
        message,
        meta,
        environment: this.environment,
        correlationId: this.getCorrelationId(),
        baseMeta: this.baseMeta,
        getLogMetadata: this.getLogMetadata,
      });
    }
  }

  private writeLog(level: LogLevel, payload: string): void {
    if (typeof process !== 'undefined' && (process.stdout || process.stderr)) {
      const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
      stream.write(`${payload}\n`);
      return;
    }

    if (level === 'error') {
      console.error(payload);
    } else if (level === 'warn') {
      console.warn(payload);
    } else {
      console.log(payload);
    }
  }
}
