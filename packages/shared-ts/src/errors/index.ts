export type ErrorCode =
  | 'ERR_INVALID_REQUEST'
  | 'ERR_DUPLICATE_USERNAME'
  | 'ERR_DUPLICATE_EMAIL'
  | 'ERR_NOT_FOUND'
  | 'ERR_UNAUTHORIZED'
  | 'ERR_FORBIDDEN'
  | 'ERR_INTERNAL';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  ERR_INVALID_REQUEST: 400,
  ERR_DUPLICATE_USERNAME: 409,
  ERR_DUPLICATE_EMAIL: 409,
  ERR_NOT_FOUND: 404,
  ERR_UNAUTHORIZED: 401,
  ERR_FORBIDDEN: 403,
  ERR_INTERNAL: 500,
};

/**
 * Structured application error that carries an `ErrorCode` and an HTTP status.
 *
 * Use this for API/domain errors that should be safely serialized and returned to clients.
 */
export class TaskforceError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;
  override readonly cause: Error | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    status?: number,
    details?: Record<string, unknown>,
    options?: { cause?: Error }
  ) {
    super(message, options);
    Object.setPrototypeOf(this, TaskforceError.prototype);
    this.name = 'TaskforceError';
    this.code = code;
    this.status = status ?? STATUS_BY_CODE[code] ?? 500;
    if (details !== undefined) {
      this.details = details;
    }
    this.cause = options?.cause;
  }

  toJSON() {
    return {
      error: this.message,
      code: this.code,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

export const isTaskforceError = (error: unknown): error is TaskforceError =>
  error instanceof TaskforceError;

export const formatErrorPayload = (error: TaskforceError) => error.toJSON();

/**
 * Error thrown during agent execution
 */
export class AgentError extends Error {
  public override cause?: Error;

  constructor(message: string, cause?: Error) {
    super(message);
    this.name = 'AgentError';
    if (cause !== undefined) {
      this.cause = cause;
    }
    Object.setPrototypeOf(this, AgentError.prototype);
  }
}

/**
 * Error thrown during tool execution
 */
export class ToolError extends Error {
  public toolName: string;
  public override cause?: Error;

  constructor(message: string, toolName: string, cause?: Error) {
    super(message);
    this.name = 'ToolError';
    this.toolName = toolName;
    if (cause !== undefined) {
      this.cause = cause;
    }
    Object.setPrototypeOf(this, ToolError.prototype);
  }
}

/**
 * Error thrown for configuration issues
 */
export class ConfigurationError extends Error {
  public configKey?: string;
  public override cause?: Error;

  constructor(message: string, configKey?: string, cause?: Error) {
    super(message);
    this.name = 'ConfigurationError';
    if (configKey !== undefined) {
      this.configKey = configKey;
    }
    if (cause !== undefined) {
      this.cause = cause;
    }
    Object.setPrototypeOf(this, ConfigurationError.prototype);
  }
}

/**
 * Error thrown during search operations
 */
export class SearchError extends Error {
  public query?: string;
  public override cause?: Error;

  constructor(message: string, query?: string, cause?: Error) {
    super(message);
    this.name = 'SearchError';
    if (query !== undefined) {
      this.query = query;
    }
    if (cause !== undefined) {
      this.cause = cause;
    }
    Object.setPrototypeOf(this, SearchError.prototype);
  }
}

/**
 * Error thrown during orchestration
 */
export class OrchestrationError extends Error {
  public stage?: string;
  public override cause?: Error;

  constructor(message: string, stage?: string, cause?: Error) {
    super(message);
    this.name = 'OrchestrationError';
    if (stage !== undefined) {
      this.stage = stage;
    }
    if (cause !== undefined) {
      this.cause = cause;
    }
    Object.setPrototypeOf(this, OrchestrationError.prototype);
  }
}

export * from './retry';
export * from './rate-limit-view';
