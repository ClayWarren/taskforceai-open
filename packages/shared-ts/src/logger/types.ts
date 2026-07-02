export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  [key: string]: string | number | boolean | null | undefined;
}

export interface LogMetadata {
  [key: string]: unknown;
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: LogContext;
  metadata?: LogMetadata;
  tags?: string[];
}

export interface LogTransport {
  name: string;
  log(entry: LogEntry): void | Promise<void>;
  flush?: () => void | Promise<void>;
}

export interface LoggerOptions {
  level?: LogLevel;
  context?: LogContext;
  transports?: LogTransport[];
  maxBufferSize?: number;
}

export interface StructuredConsoleBridgeOptions {
  levels?: LogLevel[];
  preserveNative?: boolean;
  formatMessage?: (args: unknown[]) => { message: string; metadata?: LogMetadata };
}

export const CONSOLE_BRIDGE_METADATA_KEY = '__sharedTsConsoleBridge' as const;
