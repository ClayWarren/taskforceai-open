import { mock } from 'bun:test';
import type { ZodTypeAny } from 'zod';

import { createRealtimeConnection } from './realtime';

export const mockFetch = mock();
global.fetch = mockFetch as unknown as typeof fetch;

export const waitForCondition = async (isReady: () => boolean): Promise<void> => {
  const timeoutAt = Date.now() + 1_000;
  while (Date.now() < timeoutAt) {
    if (isReady()) return;
    // oxlint-disable-next-line no-await-in-loop -- intentional polling helper for async callbacks.
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('timed out waiting for callback');
};

export const getFetchUrl = (call: unknown[]): string => {
  const input = call[0];
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  if (typeof Request !== 'undefined' && input instanceof Request) {
    return input.url;
  }
  return String(input);
};

export const isTokenUrl = (url: string): boolean => url.endsWith('/api/v1/sync/realtime/token');
export const isPollUrl = (url: string): boolean =>
  url.includes('/api/v1/sync/realtime') && !url.endsWith('/api/v1/sync/realtime/token');

export const toIntervalTick = (handler: TimerHandler): (() => void) => {
  if (typeof handler !== 'function') {
    throw new Error('expected interval handler to be a function');
  }
  return () => {
    handler();
  };
};

export const invokeIntervalTick = (tick: unknown): void => {
  if (typeof tick !== 'function') {
    throw new Error('expected interval tick to be initialized');
  }
  tick();
};

export const makeParams = (
  overrides?: Partial<Parameters<typeof createRealtimeConnection>[0]>
) => ({
  baseUrl: 'https://example.com',
  buildHeaders: async () => ({ Authorization: 'Bearer token' }),
  fetchImpl: mockFetch as unknown as typeof fetch,
  notifyUnauthorized: mock(),
  onEvent: mock(),
  logger: { warn: mock(), debug: mock() },
  parseJsonResponse: async <T>(response: Response, schema: ZodTypeAny): Promise<T> =>
    schema.parse(await response.json()) as T,
  ...overrides,
});
