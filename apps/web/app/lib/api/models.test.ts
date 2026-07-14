import { afterEach, beforeEach, describe, expect, it, mock, vi } from 'bun:test';

import type { ApiClient } from '@taskforceai/api-client/client';

type BrowserClient = Pick<ApiClient, 'getModelOptions'>;

// Mock the browser client
const mockClient = {
  getModelOptions: mock(),
} satisfies BrowserClient;

// Mock dependencies BEFORE importing the module
mock.module('@taskforceai/api-client/browserClient', () => ({
  getBrowserClient: mock(() => mockClient),
}));

mock.module('../logger', () => ({
  logger: {
    error: mock(),
    warn: mock(),
    info: mock(),
  },
}));

// Dynamically import the module to ensure mocks are applied
const { fetchModelOptions, fetchModelSelectorSnapshot } = await import('./models');

describe('Models API', () => {
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  describe('fetchModelOptions', () => {
    it('returns success with data', async () => {
      const mockData = { enabled: true, options: [], defaultModelId: 'gpt-4' };
      mockClient.getModelOptions.mockResolvedValue(mockData);

      const result = await fetchModelOptions({ logger: mockLogger });
      expect(result.ok).toBe(true);
      expect(mockClient.getModelOptions).toHaveBeenCalledTimes(1);
      const [requestInit] = mockClient.getModelOptions.mock.calls[0] ?? [];
      expect(requestInit).toBeObject();
      expect(requestInit.signal).toBeInstanceOf(AbortSignal);
      if (result.ok) {
        expect(result.value).toEqual(mockData);
      }
    });

    it('returns error on failure', async () => {
      mockClient.getModelOptions.mockRejectedValue(new Error('Failed'));

      const result = await fetchModelOptions({ logger: mockLogger });
      expect(result.ok).toBe(false);
    });

    it('maps unauthorized and server status errors', async () => {
      mockClient.getModelOptions.mockRejectedValueOnce(
        Object.assign(new Error('Unauthorized'), { status: 401 })
      );
      const unauthorized = await fetchModelOptions({ logger: mockLogger });
      expect(unauthorized.ok).toBe(false);
      if (!unauthorized.ok) {
        expect(unauthorized.error.kind).toBe('unauthorized');
        expect(unauthorized.error.status).toBe(401);
      }

      mockClient.getModelOptions.mockRejectedValueOnce(
        Object.assign(new Error('Server'), { status: 503 })
      );
      const server = await fetchModelOptions({ logger: mockLogger });
      expect(server.ok).toBe(false);
      if (!server.ok) {
        expect(server.error.kind).toBe('server');
        expect(server.error.status).toBe(503);
      }
    });

    it('uses the fallback model options message for non-Error failures', async () => {
      mockClient.getModelOptions.mockRejectedValue({});

      const result = await fetchModelOptions({ logger: mockLogger });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toEqual({
          kind: 'network',
          message: 'Failed to load model options',
        });
      }
    });

    it('allows model option failures without a logger', async () => {
      mockClient.getModelOptions.mockRejectedValue(new Error('offline'));

      const result = await fetchModelOptions({ logger: null });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toEqual({ kind: 'network', message: 'offline' });
      }
    });

    it('times out long-running model option requests', async () => {
      vi.useFakeTimers();
      mockClient.getModelOptions.mockImplementation(
        () =>
          new Promise(() => {
            /* never resolves */
          })
      );

      const pending = fetchModelOptions({ logger: mockLogger });
      vi.advanceTimersByTime(30_001);
      const result = await pending;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('timed out');
      }

      vi.useRealTimers();
    });
  });

  describe('fetchModelSelectorSnapshot', () => {
    let originalWindow: typeof globalThis.window | undefined;

    const setWindow = (value: typeof globalThis.window | undefined) => {
      Object.defineProperty(globalThis, 'window', {
        value,
        configurable: true,
        writable: true,
      });
    };

    beforeEach(() => {
      originalWindow = globalThis.window;
    });

    afterEach(() => {
      setWindow(originalWindow);
    });

    const mockBaseUrl = 'http://localhost:3000';

    it('returns error when running on server without baseUrl', async () => {
      // Simulate server environment (no window)
      setWindow(undefined);

      const result = await fetchModelSelectorSnapshot({ baseUrl: '', logger: mockLogger });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('unavailable during build');
      }
    });

    it('returns success when API returns valid data', async () => {
      const mockData = { enabled: true, options: [], defaultModelId: 'gpt-4' };
      const mockFetch = Object.assign(
        mock(() => Promise.resolve(new Response(JSON.stringify(mockData), { status: 200 }))),
        { preconnect: () => {} }
      );

      const result = await fetchModelSelectorSnapshot({
        baseUrl: mockBaseUrl,
        returnFetch: mockFetch,
        logger: mockLogger,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(mockData);
      }
    });

    it('returns validation error on invalid data', async () => {
      const mockFetch = Object.assign(
        mock(() =>
          Promise.resolve(new Response(JSON.stringify({ invalid: 'data' }), { status: 200 }))
        ),
        { preconnect: () => {} }
      );

      const result = await fetchModelSelectorSnapshot({
        baseUrl: mockBaseUrl,
        returnFetch: mockFetch,
        logger: mockLogger,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('validation');
      }
    });

    it('returns server error on API failure', async () => {
      const mockFetch = Object.assign(
        mock(() => Promise.resolve(new Response(JSON.stringify({}), { status: 500 }))),
        { preconnect: () => {} }
      );

      const result = await fetchModelSelectorSnapshot({
        baseUrl: mockBaseUrl,
        returnFetch: mockFetch,
        logger: mockLogger,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('server');
      }
    });

    it('returns network error on exception', async () => {
      const mockFetch = Object.assign(
        mock(() => Promise.reject(new Error('Failed'))),
        {
          preconnect: () => {},
        }
      );

      const result = await fetchModelSelectorSnapshot({
        baseUrl: mockBaseUrl,
        returnFetch: mockFetch,
        logger: mockLogger,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('network');
      }
    });

    it('combines caller abort signals with the snapshot timeout signal', async () => {
      const externalController = new AbortController();
      let observedSignal: AbortSignal | undefined;
      const mockFetch = Object.assign(
        mock((_input: RequestInfo | URL, init?: RequestInit) => {
          observedSignal = init?.signal ?? undefined;
          externalController.abort();
          return Promise.reject(new Error('aborted'));
        }),
        { preconnect: () => {} }
      );

      const result = await fetchModelSelectorSnapshot({
        baseUrl: mockBaseUrl,
        returnFetch: ((input: RequestInfo | URL, init?: RequestInit) =>
          mockFetch(input, {
            ...init,
            signal: externalController.signal,
          })) as unknown as typeof fetch,
        logger: mockLogger,
      });

      expect(result.ok).toBe(false);
      expect(observedSignal).toBeInstanceOf(AbortSignal);
    });

    it('aborts snapshot requests when the timeout elapses', async () => {
      vi.useFakeTimers();
      try {
        let observedSignal: AbortSignal | undefined;
        const mockFetch = Object.assign(
          mock(
            (_input: RequestInfo | URL, init?: RequestInit) =>
              new Promise<Response>((_resolve, reject) => {
                observedSignal = init?.signal ?? undefined;
                observedSignal?.addEventListener('abort', () => {
                  reject(new Error('snapshot aborted'));
                });
              })
          ),
          { preconnect: () => {} }
        );

        const pending = fetchModelSelectorSnapshot({
          baseUrl: mockBaseUrl,
          returnFetch: mockFetch,
          logger: mockLogger,
        });

        vi.advanceTimersByTime(30_001);
        const result = await pending;

        expect(result.ok).toBe(false);
        expect(observedSignal?.aborted).toBe(true);
        if (!result.ok) {
          expect(result.error.kind).toBe('network');
        }
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
