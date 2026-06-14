// Conditional check for Node.js environment
import { systemRNG } from '../random/rng';

const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;

/**
 * Request-scoped (and job-scoped) logging context utilities.
 *
 * Uses `AsyncLocalStorage` in Node.js to propagate a correlation ID and optional metadata across async boundaries,
 * so logs can be stitched together for a single request/flow without threading values through every call.
 *
 * In browser environments, this is a no-op shim to prevent build failures.
 */
export interface LogContextValue {
  /** Correlation identifier for tracing a single request/flow across logs and services. */
  correlationId: string;
  /** Extra structured fields to attach to logs; merged from parent context when nested. */
  metadata?: Record<string, unknown>;
}

// Minimal shim for browser environments where AsyncLocalStorage isn't supported
class BrowserStorageShim<T> {
  getStore(): T | undefined {
    return undefined;
  }
  run<R>(_store: T, fn: () => R): R {
    return fn();
  }
  enterWith(_store: T): void {}
}

const createStorage = () => {
  if (isNode) {
    try {
      // Use dynamic require to avoid build-time errors in browser bundlers
      const mod = require('node:async_hooks') as {
        AsyncLocalStorage: new <T>() => BrowserStorageShim<T>;
      };
      return new mod.AsyncLocalStorage<LogContextValue>();
    } catch {
      return new BrowserStorageShim<LogContextValue>();
    }
  }
  return new BrowserStorageShim<LogContextValue>();
};

const storage = createStorage();

/** Cross-platform UUID generator */
const getUUID = (): string => systemRNG.uuid();

/** Incoming request header used to accept an upstream correlation identifier. */
export const CORRELATION_ID_HEADER = 'x-correlation-id';

const ensureContext = (partial?: Partial<LogContextValue>): LogContextValue => {
  const parent = storage.getStore();
  const correlationId = partial?.correlationId ?? parent?.correlationId ?? getUUID();

  const mergedMetadata: Record<string, unknown> = {};
  if (parent?.metadata) {
    Object.assign(mergedMetadata, parent.metadata);
  }
  if (partial?.metadata) {
    Object.assign(mergedMetadata, partial.metadata);
  }

  const context: LogContextValue = { correlationId };
  if (Object.keys(mergedMetadata).length > 0) {
    context.metadata = mergedMetadata;
  }
  return context;
};

/**
 * Runs `fn` within a log context.
 *
 * - If a parent context exists, metadata is merged (parent first, then `partial`).
 * - If no correlation ID exists yet, a new UUID is generated.
 */
export const runWithLogContext = <T>(
  partial: Partial<LogContextValue>,
  fn: () => T | Promise<T>
): T | Promise<T> => {
  const context = ensureContext(partial);
  return storage.run(context, fn);
};

/**
 * Returns the current log context, if one is active for this async execution path.
 */
export const getLogContext = (): LogContextValue | undefined => storage.getStore();

/**
 * Convenience accessor for the current correlation ID, if present.
 */
export const getCorrelationId = (): string | undefined => storage.getStore()?.correlationId;

/**
 * Returns the current log metadata or an empty object if no context exists.
 */
export const getLogMetadata = (): Record<string, unknown> => storage.getStore()?.metadata ?? {};

/**
 * Appends structured metadata to the current context.
 *
 * If no context exists, this creates one with a new correlation ID.
 */
export const appendLogMetadata = (meta: Record<string, unknown>): void => {
  const store = storage.getStore();
  const currentMeta = store?.metadata ?? {};
  const nextMeta = { ...currentMeta, ...meta };

  if (store) {
    store.metadata = nextMeta;
  } else {
    storage.enterWith({
      correlationId: getUUID(),
      metadata: nextMeta,
    });
  }
};

/**
 * Creates a log context for a `Request` by extracting a correlation ID and basic request metadata.
 *
 * This accepts `x-correlation-id` (preferred) and falls back to `x-request-id`.
 */
export const withRequestContext = <T>(
  request: Request | null | undefined,
  fn: () => T | Promise<T>
): T | Promise<T> => {
  const headers = request?.headers;
  const incomingCorrelationId =
    headers?.get(CORRELATION_ID_HEADER) ?? headers?.get('x-request-id') ?? undefined;

  const metadata: Record<string, unknown> = {};

  if (request?.method) {
    metadata['method'] = request.method;
  }

  if (request?.url) {
    metadata['url'] = request.url;
  }

  const partial: Partial<LogContextValue> = {};
  if (incomingCorrelationId !== undefined) {
    partial.correlationId = incomingCorrelationId;
  }
  if (Object.keys(metadata).length > 0) {
    partial.metadata = metadata;
  }

  return runWithLogContext(partial, fn);
};
