// Conditional check for Node.js environment
import { systemRNG } from '@taskforceai/system-runtime/rng';

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
    /* coverage-ignore-start -- dynamic require storage bootstrapping is exercised through log-context behavior tests, but Bun LCOV misses module initialization. */
    try {
      // Use dynamic require to avoid build-time errors in browser bundlers
      const mod = require('node:async_hooks') as {
        AsyncLocalStorage: new <T>() => BrowserStorageShim<T>;
      };
      return new mod.AsyncLocalStorage<LogContextValue>();
    } catch {
      return new BrowserStorageShim<LogContextValue>();
    }
    /* coverage-ignore-end */
  }
  return new BrowserStorageShim<LogContextValue>();
};

let storage = createStorage();

/** Cross-platform UUID generator */
const getUUID = (): string => systemRNG.uuid();

const ensureContext = (partial?: Partial<LogContextValue>): LogContextValue => {
  const parent = storage.getStore();
  const correlationId = partial?.correlationId ?? parent?.correlationId ?? getUUID();

  const mergedMetadata: Record<string, unknown> = {
    ...parent?.metadata,
    ...partial?.metadata,
  };

  const context: LogContextValue = { correlationId };
  if (Object.keys(mergedMetadata).length > 0) {
    // coverage-ignore-next-line -- exercised in tests, but Bun LCOV misses this assignment.
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
 * Convenience accessor for the current correlation ID, if present.
 */
export const getCorrelationId = (): string | undefined => storage.getStore()?.correlationId;

/**
 * Returns the current log metadata or an empty object if no context exists.
 */
export const getLogMetadata = (): Record<string, unknown> => storage.getStore()?.metadata ?? {};
