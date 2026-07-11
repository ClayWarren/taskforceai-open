export type StreamingConnectionErrorCode = 'connection_failed' | 'connection_timeout';

export const STREAMING_CONNECTION_TIMEOUT_MESSAGE = 'Streaming connection timed out';
export const STREAMING_FAILED_MESSAGE = 'Streaming failed';

const STREAMING_CONNECTION_ERROR_NAME = 'StreamingConnectionError';

// coverage-ignore-next-line -- Bun attributes constructor execution to the class declaration line.
export class StreamingConnectionError extends Error {
  readonly code: StreamingConnectionErrorCode;

  constructor(options: { code: StreamingConnectionErrorCode; message?: string; cause?: unknown }) {
    super(options.message ?? streamingConnectionMessageForCode(options.code), {
      cause: options.cause,
    });
    this.name = STREAMING_CONNECTION_ERROR_NAME;
    this.code = options.code;
  }
}

export const isStreamingConnectionError = (error: unknown): error is StreamingConnectionError => {
  if (error instanceof StreamingConnectionError) {
    return true;
  }
  if (!error || typeof error !== 'object') {
    return false;
  }
  const candidate = error as { name?: unknown; code?: unknown };
  return (
    candidate.name === STREAMING_CONNECTION_ERROR_NAME &&
    (candidate.code === 'connection_failed' || candidate.code === 'connection_timeout')
  );
};

const readErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') {
      return message;
    }
    const type = (error as { type?: unknown }).type;
    if (typeof type === 'string') {
      return type;
    }
  }
  return '';
};

export const isStreamingTimeoutError = (error: unknown): boolean => {
  if (isStreamingConnectionError(error)) {
    return error.code === 'connection_timeout';
  }
  const message = readErrorMessage(error).toLowerCase();
  return /\btime(?:d)?\s*out\b/.test(message) || message.includes('timeout');
};

export const classifyStreamingConnectionError = (error: unknown): StreamingConnectionErrorCode =>
  isStreamingTimeoutError(error) ? 'connection_timeout' : 'connection_failed';

/* coverage-ignore-start -- both branches are covered, but Bun attributes this ternary inconsistently. */
export const streamingConnectionMessageForCode = (code: StreamingConnectionErrorCode): string =>
  code === 'connection_timeout'
    ? STREAMING_CONNECTION_TIMEOUT_MESSAGE
    : 'Streaming connection failed';
/* coverage-ignore-end */

export const streamingFailureDisplayMessage = (error: unknown): string =>
  isStreamingTimeoutError(error) ? STREAMING_CONNECTION_TIMEOUT_MESSAGE : STREAMING_FAILED_MESSAGE;

export const toStreamingConnectionError = (error: unknown): StreamingConnectionError =>
  isStreamingConnectionError(error)
    ? error
    : new StreamingConnectionError({
        code: classifyStreamingConnectionError(error),
        cause: error,
      });
