import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { createBufferingLogger } from '#tests/fixtures/buffering-logger';

import { createHttpSyncClient } from './client';
import { configureSyncLogger } from './logger';

const testLogger = createBufferingLogger();
configureSyncLogger(testLogger.logger);

describe('shared/sync/client', () => {
  const mockFetch = mock();
  global.fetch = mockFetch as any;

  const getToken = () => 'test-token';
  const onUnauthorized = mock();

  beforeEach(() => {
    mockFetch.mockReset();
    onUnauthorized.mockReset();
    testLogger.clearBuffer();
  });

  it('pull > successfully pulls changes from server', async () => {
    const mockResponse = {
      latest_version: 5,
      conversations: [],
      messages: [],
      deletions: [],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const client = createHttpSyncClient('http://localhost:3000', getToken);
    const result = await client.pull(3, 'device-123');

    expect(result).toEqual(mockResponse);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/sync/pull',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ last_sync_version: 3, device_id: 'device-123', limit: 5 }),
      })
    );

    // Verify headers separately since they are now a Headers object
    const callArgs = mockFetch.mock.calls[0]![1];
    const headers = callArgs!.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer test-token');
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('pull > throws error on failed pull', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    const client = createHttpSyncClient('http://localhost:3000', getToken);

    await expect(client.pull(0, 'device-123')).rejects.toThrow();
  });

  it('pull > calls onUnauthorized on 401 error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    });

    const client = createHttpSyncClient('http://localhost:3000', getToken, { onUnauthorized });

    await expect(client.pull(0, 'device-123')).rejects.toThrow();
    expect(onUnauthorized).toHaveBeenCalledWith({ source: 'pull' });
  });

  it('pull > calls onUnauthorized on 403 error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
    });

    const client = createHttpSyncClient('http://localhost:3000', getToken, { onUnauthorized });

    await expect(client.pull(0, 'device-123')).rejects.toThrow();
    expect(onUnauthorized).toHaveBeenCalledWith({ source: 'pull' });
  });

  it('pull > does not use stale fallback on 403 error', async () => {
    const cachedPull = {
      latest_version: 1,
      conversations: [],
      messages: [],
      deletions: [],
    };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => cachedPull,
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      });

    const client = createHttpSyncClient('http://localhost:3000', getToken, { onUnauthorized });
    await expect(client.pull(0, 'device-123')).resolves.toEqual(cachedPull);
    await expect(client.pull(0, 'device-123')).rejects.toThrow('Sync pull failed (403 Forbidden)');
    expect(onUnauthorized).toHaveBeenCalledWith({ source: 'pull' });
  });

  it('pull > includes authorization header when token available', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        latest_version: 1,
        conversations: [],
        messages: [],
        deletions: [],
      }),
    });

    const client = createHttpSyncClient('http://localhost:3000', () => 'my-token');
    await client.pull(0, 'device-123');

    const callArgs = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]![1];
    const headers = callArgs!.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer my-token');
  });

  it('pull > normalizes invalid sync version and blank device ID', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        latest_version: 1,
        conversations: [],
        messages: [],
        deletions: [],
      }),
    });

    const client = createHttpSyncClient('http://localhost:3000', getToken);
    await client.pull(Number.NaN, '   ');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/sync/pull',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ last_sync_version: 0, device_id: 'web-fallback-device', limit: 5 }),
      })
    );
  });

  it('pull > preserves pagination metadata from server responses', async () => {
    const mockResponse = {
      latest_version: 5,
      conversations: [],
      messages: [],
      deletions: [],
      has_more: true,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const client = createHttpSyncClient('http://localhost:3000', getToken);
    const result = await client.pull(3, 'device-123');

    expect(result).toEqual(mockResponse);
    expect(result.has_more).toBe(true);
  });

  it('pull > adds CSRF token for state-changing requests', async () => {
    const getCsrfToken = mock(() => 'csrf-token');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        latest_version: 1,
        conversations: [],
        messages: [],
        deletions: [],
      }),
    });

    const client = createHttpSyncClient('http://localhost:3000', getToken, { getCsrfToken });
    await client.pull(0, 'device-123');

    const callArgs = mockFetch.mock.calls[0]![1];
    const headers = callArgs!.headers as Headers;
    expect(getCsrfToken).toHaveBeenCalled();
    expect(headers.get('X-CSRF-Token')).toBe('csrf-token');
  });

  it('pull > retries retryable HTTP responses before succeeding', async () => {
    const mockResponse = {
      latest_version: 2,
      conversations: [],
      messages: [],
      deletions: [],
    };

    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

    const client = createHttpSyncClient('http://localhost:3000', getToken, {
      resilience: { retryAttempts: 2, baseDelayMs: 1, maxDelayMs: 1, jitterMs: 0 },
    });

    await expect(client.pull(0, 'device-123')).resolves.toEqual(mockResponse);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('emits request metrics for attempts, retries, success, and timers', async () => {
    const stopTimer = mock();
    const metrics = {
      incrementCounter: mock(),
      startTimer: mock(() => stopTimer),
    };
    const mockResponse = {
      latest_version: 2,
      conversations: [],
      messages: [],
      deletions: [],
    };

    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

    const client = createHttpSyncClient('http://localhost:3000', getToken, {
      metrics,
      resilience: { retryAttempts: 2, baseDelayMs: 1, maxDelayMs: 1, jitterMs: 0 },
    });

    await expect(client.pull(0, 'device-123')).resolves.toEqual(mockResponse);

    expect(metrics.incrementCounter).toHaveBeenCalledWith('sync.client.request.total', {
      endpoint: 'pull',
      method: 'POST',
      source: 'pull',
    });
    expect(metrics.incrementCounter).toHaveBeenCalledWith('sync.client.request.retry', {
      endpoint: 'pull',
      method: 'POST',
      source: 'pull',
      attempt: 1,
      status: 503,
      reason: 'http_status',
    });
    expect(metrics.incrementCounter).toHaveBeenCalledWith('sync.client.request.success', {
      endpoint: 'pull',
      method: 'POST',
      source: 'pull',
    });
    expect(metrics.startTimer).toHaveBeenCalledTimes(2);
    expect(stopTimer).toHaveBeenCalledTimes(2);
  });

  it('emits failure and parse failure metrics without stale fallback', async () => {
    const metrics = {
      incrementCounter: mock(),
      startTimer: mock(() => mock()),
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        conversations: [],
        messages: [],
        deletions: [],
      }),
    });

    const client = createHttpSyncClient('http://localhost:3000', getToken, {
      metrics,
      resilience: { retryAttempts: 1 },
    });

    await expect(client.pull(0, 'device-123')).rejects.toThrow('Sync pull response parsing failed');

    expect(metrics.incrementCounter).toHaveBeenCalledWith('sync.client.request.parse_failure', {
      endpoint: 'pull',
      method: 'POST',
      source: 'pull',
    });
    expect(metrics.incrementCounter).toHaveBeenCalledWith(
      'sync.client.request.failure',
      expect.objectContaining({
        endpoint: 'pull',
        method: 'POST',
        source: 'pull',
        parseFailure: true,
        error: 'SyncParseError',
      })
    );
  });

  it('pull > cancels retry backoff when the caller aborts', async () => {
    const metrics = {
      incrementCounter: mock(),
      startTimer: mock(() => mock()),
    };
    const cachedPull = {
      latest_version: 2,
      conversations: [],
      messages: [],
      deletions: [],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => cachedPull,
    });

    const client = createHttpSyncClient('http://localhost:3000', getToken, {
      metrics,
      resilience: { retryAttempts: 2, baseDelayMs: 5_000, maxDelayMs: 5_000, jitterMs: 0 },
    });

    await expect(client.pull(0, 'device-123')).resolves.toEqual(cachedPull);

    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    const controller = new AbortController();
    const request = client.pull(0, 'device-123', { signal: controller.signal });

    setTimeout(() => controller.abort(), 10);

    await expect(request).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(metrics.incrementCounter).toHaveBeenCalledWith('sync.client.request.aborted', {
      endpoint: 'pull',
      method: 'POST',
      source: 'pull',
    });
  });

  it('pull > aborts requests that exceed the sync client timeout', async () => {
    const metrics = {
      incrementCounter: mock(),
      startTimer: mock(() => mock()),
    };
    mockFetch.mockImplementationOnce(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted', 'AbortError'));
          });
        })
    );

    const client = createHttpSyncClient('http://localhost:3000', getToken, {
      metrics,
      resilience: {
        timeoutMs: 1000,
        retryAttempts: 1,
        baseDelayMs: 10,
        maxDelayMs: 10,
        jitterMs: 0,
      },
    });

    await expect(client.pull(0, 'device-123')).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(metrics.incrementCounter).toHaveBeenCalledWith('sync.client.request.failure', {
      endpoint: 'pull',
      method: 'POST',
      source: 'pull',
      parseFailure: false,
      error: 'AbortError',
    });
  });

  it('pull > does not retry non-retryable HTTP responses', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
    });

    const client = createHttpSyncClient('http://localhost:3000', getToken, {
      resilience: { retryAttempts: 2, baseDelayMs: 1, maxDelayMs: 1, jitterMs: 0 },
    });

    await expect(client.pull(0, 'device-123')).rejects.toThrow(
      'Sync pull failed (400 Bad Request)'
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('pull > logs terminal HTTP failures with endpoint context', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => 'invalid cursor',
    });

    const client = createHttpSyncClient('http://localhost:3000', getToken, {
      resilience: { retryAttempts: 2, baseDelayMs: 1, maxDelayMs: 1, jitterMs: 0 },
    });

    await expect(client.pull(0, 'device-123')).rejects.toThrow(
      'Sync pull failed (400 Bad Request): invalid cursor'
    );

    const finalFailure = testLogger
      .getBuffer()
      .find((entry) => entry.message === 'Sync request failed without retry or fallback');
    expect(finalFailure).toMatchObject({
      level: 'warn',
      metadata: {
        endpoint: 'pull',
        method: 'POST',
        source: 'pull',
        status: 400,
        statusText: 'Bad Request',
        attempt: 1,
        retryAttempts: 2,
        bodyPreview: 'invalid cursor',
      },
    });
  });

  it('pull > returns stale pull cache after a later transport failure', async () => {
    const metrics = {
      incrementCounter: mock(),
      startTimer: mock(() => mock()),
    };
    const cachedPull = {
      latest_version: 3,
      conversations: [],
      messages: [],
      deletions: [],
    };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => cachedPull,
      })
      .mockRejectedValueOnce(new Error('offline'));

    const client = createHttpSyncClient('http://localhost:3000', getToken, {
      metrics,
      resilience: { retryAttempts: 1 },
    });

    await expect(client.pull(0, 'device-123')).resolves.toEqual(cachedPull);
    await expect(client.pull(0, 'device-123')).resolves.toEqual(cachedPull);
    expect(metrics.incrementCounter).toHaveBeenCalledWith('sync.client.request.fallback', {
      endpoint: 'pull',
      method: 'POST',
      source: 'pull',
      reason: 'transport_failure',
    });
  });

  it('pull > does not use stale pull cache for a different version cursor', async () => {
    const cachedPull = {
      latest_version: 3,
      conversations: [],
      messages: [],
      deletions: [],
    };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => cachedPull,
      })
      .mockRejectedValueOnce(new Error('offline'));

    const client = createHttpSyncClient('http://localhost:3000', getToken, {
      resilience: { retryAttempts: 1 },
    });

    await expect(client.pull(0, 'device-123')).resolves.toEqual(cachedPull);
    await expect(client.pull(3, 'device-123')).rejects.toThrow('offline');
  });

  it('pull > does not use stale pull cache after the auth token changes', async () => {
    const cachedPull = {
      latest_version: 3,
      conversations: [],
      messages: [],
      deletions: [],
    };
    let token = 'test-token';

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => cachedPull,
      })
      .mockRejectedValueOnce(new Error('offline'));

    const client = createHttpSyncClient('http://localhost:3000', () => token, {
      resilience: { retryAttempts: 1 },
    });

    await expect(client.pull(0, 'device-123')).resolves.toEqual(cachedPull);
    token = 'rotated-token';
    await expect(client.pull(0, 'device-123')).rejects.toThrow('offline');
  });

  it('pull > does not use stale pull cache after a response parsing failure', async () => {
    const cachedPull = {
      latest_version: 3,
      conversations: [],
      messages: [],
      deletions: [],
    };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => cachedPull,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          conversations: [],
          messages: [],
          deletions: [],
        }),
      });

    const client = createHttpSyncClient('http://localhost:3000', getToken, {
      resilience: { retryAttempts: 1 },
    });

    await expect(client.pull(0, 'device-123')).resolves.toEqual(cachedPull);
    await expect(client.pull(0, 'device-123')).rejects.toThrow('Sync pull response parsing failed');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('pull > logs terminal response parsing failures', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        conversations: [],
        messages: [],
        deletions: [],
      }),
    });

    const client = createHttpSyncClient('http://localhost:3000', getToken, {
      resilience: { retryAttempts: 2, baseDelayMs: 1, maxDelayMs: 1, jitterMs: 0 },
    });

    await expect(client.pull(0, 'device-123')).rejects.toThrow('Sync pull response parsing failed');

    const finalFailure = testLogger
      .getBuffer()
      .find((entry) => entry.message === 'Sync request failed without retry or fallback');
    expect(finalFailure).toMatchObject({
      level: 'error',
      metadata: {
        endpoint: 'pull',
        method: 'POST',
        source: 'pull',
        attempt: 1,
        retryAttempts: 2,
        parseFailure: true,
      },
    });
  });

  it('pull > reports malformed success JSON as a parse failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    });

    const client = createHttpSyncClient('http://localhost:3000', getToken, {
      resilience: { retryAttempts: 2, baseDelayMs: 1, maxDelayMs: 1, jitterMs: 0 },
    });

    await expect(client.pull(0, 'device-123')).rejects.toThrow('Sync pull response parsing failed');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const finalFailure = testLogger
      .getBuffer()
      .find((entry) => entry.message === 'Sync request failed without retry or fallback');
    expect(finalFailure).toMatchObject({
      level: 'error',
      metadata: {
        endpoint: 'pull',
        parseFailure: true,
      },
    });
  });

  it('push > successfully pushes changes to server', async () => {
    const mockResponse = {
      new_version: 2,
      accepted: ['conv-1'],
      conflicts: [],
      conversation_id_mappings: { 'conv-1': 1 },
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const conversations = [
      {
        id: 1,
        local_id: 'conv-1',
        timestamp: '2025-01-01T00:00:00Z',
        user_id: 'user-1',
        user_input: 'Test',
        sync_version: 1,
        last_synced_at: '2025-01-01T00:00:00Z',
        is_deleted: false,
        updated_at: '2025-01-01T00:00:00Z',
      },
    ];
    const messages = [
      {
        message_id: 'msg-1',
        conversation_id: 1,
        role: 'user',
        content: 'Hello',
        is_streaming: false,
        is_agent_status: false,
        created_at: '2025-01-01T00:00:00Z',
        sync_version: 1,
        last_synced_at: '2025-01-01T00:00:00Z',
        is_deleted: false,
        updated_at: '2025-01-01T00:00:00Z',
      },
    ];
    const deletions: any[] = [];

    const client = createHttpSyncClient('http://localhost:3000', getToken);
    const result = await client.push(conversations, messages, deletions, 'device-123');

    expect(result).toEqual(mockResponse);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/sync/push',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          conversations,
          messages,
          deletions,
          device_id: 'device-123',
        }),
      })
    );

    const callArgs = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]![1];
    const headers = callArgs!.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer test-token');
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('push > throws error on failed push', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
    });

    const client = createHttpSyncClient('http://localhost:3000', getToken);

    await expect(client.push([], [], [], 'device-123')).rejects.toThrow();
  });

  it('push > normalizes blank device ID', async () => {
    const mockResponse = {
      new_version: 2,
      accepted: [],
      conflicts: [],
      conversation_id_mappings: {},
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const client = createHttpSyncClient('http://localhost:3000', getToken);
    await client.push([], [], [], '   ');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/sync/push',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          conversations: [],
          messages: [],
          deletions: [],
          device_id: 'web-fallback-device',
        }),
      })
    );
  });

  it('push > does not retry when response parsing fails', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error('malformed json');
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          new_version: 2,
          accepted: [],
          conflicts: [],
          conversation_id_mappings: {},
        }),
      });

    const client = createHttpSyncClient('http://localhost:3000', getToken, {
      resilience: { retryAttempts: 2, baseDelayMs: 1, maxDelayMs: 1, jitterMs: 0 },
    });

    await expect(client.push([], [], [], 'device-123')).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('push > reuses one idempotency key across transport retries', async () => {
    mockFetch.mockRejectedValueOnce(new Error('connection reset')).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        new_version: 2,
        accepted: [],
        conflicts: [],
        conversation_id_mappings: {},
      }),
    });

    const client = createHttpSyncClient('http://localhost:3000', getToken, {
      resilience: { retryAttempts: 2, baseDelayMs: 1, maxDelayMs: 1, jitterMs: 0 },
    });

    await client.push([], [], [], 'device-123');

    const firstHeaders = new Headers(mockFetch.mock.calls[0]?.[1]?.headers);
    const secondHeaders = new Headers(mockFetch.mock.calls[1]?.[1]?.headers);
    expect(firstHeaders.get('X-Sync-Id')).toBeTruthy();
    expect(secondHeaders.get('X-Sync-Id')).toBe(firstHeaders.get('X-Sync-Id'));
  });

  it('getStatus > successfully gets sync status', async () => {
    const mockStatus = {
      last_synced_at: '2025-01-01T00:00:00Z',
      sync_version: 10,
      pending_changes: 0,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockStatus,
    });

    const client = createHttpSyncClient('http://localhost:3000', getToken);
    const status = await client.getStatus();

    expect(status).toEqual(mockStatus);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/sync/status',
      expect.objectContaining({
        method: 'GET',
      })
    );

    const callArgs = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]![1];
    const headers = callArgs!.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer test-token');
  });

  it('uses provided fetch implementation for sync and realtime requests', async () => {
    const customFetch = mock();
    customFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          latest_version: 1,
          conversations: [],
          messages: [],
          deletions: [],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'sync-token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ messages: [], lastId: '$' }),
      });

    const client = createHttpSyncClient('http://localhost:3000', getToken, {
      fetchImpl: customFetch as unknown as typeof fetch,
    });

    await client.pull(0, 'device-123');
    const disconnect = client.connectRealtime(() => {});
    await new Promise((resolve) => setTimeout(resolve, 10));
    disconnect();

    expect(customFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/sync/pull',
      expect.anything()
    );
    expect(customFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/sync/realtime/token',
      expect.anything()
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('getStatus > tolerates responses that omit last_synced_at', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        sync_version: 10,
        pending_changes: 0,
      }),
    });

    const client = createHttpSyncClient('http://localhost:3000', getToken);
    const status = await client.getStatus();

    expect(status).toEqual({
      last_synced_at: '',
      sync_version: 10,
      pending_changes: 0,
    });
  });

  it('getStatus > does not use stale fallback on 403 error', async () => {
    const cachedStatus = {
      last_synced_at: '2025-01-01T00:00:00Z',
      sync_version: 10,
      pending_changes: 0,
    };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => cachedStatus,
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      });

    const client = createHttpSyncClient('http://localhost:3000', getToken, { onUnauthorized });
    await expect(client.getStatus()).resolves.toEqual(cachedStatus);
    await expect(client.getStatus()).rejects.toThrow('Sync status failed (403 Forbidden)');
    expect(onUnauthorized).toHaveBeenCalledWith({ source: 'status' });
  });

  it('getStatus > returns stale status cache after a later HTTP failure', async () => {
    const metrics = {
      incrementCounter: mock(),
      startTimer: mock(() => mock()),
    };
    const cachedStatus = {
      last_synced_at: '2025-01-01T00:00:00Z',
      sync_version: 10,
      pending_changes: 0,
    };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => cachedStatus,
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

    const client = createHttpSyncClient('http://localhost:3000', getToken, {
      metrics,
      resilience: { retryAttempts: 1 },
    });

    await expect(client.getStatus()).resolves.toEqual(cachedStatus);
    await expect(client.getStatus()).resolves.toEqual(cachedStatus);
    expect(metrics.incrementCounter).toHaveBeenCalledWith('sync.client.request.fallback', {
      endpoint: 'status',
      method: 'GET',
      source: 'status',
      status: 500,
      reason: 'http_failure',
    });
  });

  it('getStatus > does not use stale status cache after response parsing fails', async () => {
    const cachedStatus = {
      last_synced_at: '2025-01-01T00:00:00Z',
      sync_version: 10,
      pending_changes: 0,
    };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => cachedStatus,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sync_version: 'not-a-number',
          pending_changes: 0,
        }),
      });

    const client = createHttpSyncClient('http://localhost:3000', getToken, {
      resilience: { retryAttempts: 1 },
    });

    await expect(client.getStatus()).resolves.toEqual(cachedStatus);
    await expect(client.getStatus()).rejects.toThrow('Sync status response parsing failed');
  });
});
