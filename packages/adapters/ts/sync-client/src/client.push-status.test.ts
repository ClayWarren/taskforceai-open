import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { createBufferingLogger } from '#tests/fixtures/buffering-logger';

import { createHttpSyncClient } from './client';
import { configureSyncLogger } from './logger';

const testLogger = createBufferingLogger();
configureSyncLogger(testLogger.logger);

describe('shared/sync/client push and status', () => {
  const mockFetch = mock();
  global.fetch = mockFetch as any;

  const getToken = () => 'test-token';
  const onUnauthorized = mock();

  beforeEach(() => {
    mockFetch.mockReset();
    onUnauthorized.mockReset();
    testLogger.clearBuffer();
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

  it('getStatus > does not use stale fallback for permanent client errors', async () => {
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
        status: 400,
        statusText: 'Bad Request',
      });

    const client = createHttpSyncClient('http://localhost:3000', getToken, {
      resilience: { retryAttempts: 1 },
    });
    await expect(client.getStatus()).resolves.toEqual(cachedStatus);
    await expect(client.getStatus()).rejects.toThrow('Sync status failed (400 Bad Request)');
    expect(mockFetch).toHaveBeenCalledTimes(2);
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
