import type {
  BroadcastEvent,
  ConversationSyncPayload,
  DeletionRecord,
  SyncClient,
  MessageSyncPayload,
  SyncPullResponse,
  SyncPushResponse,
} from '@taskforceai/sync-client';
import { beforeEach, describe, expect, it, vi } from 'bun:test';

const httpClient = {
  pull: vi.fn(),
  push: vi.fn(),
  getStatus: vi.fn(),
  connectRealtime: vi.fn(),
};

const createHttpSyncClient = vi.fn(() => httpClient);

const loggerMock = {
  warn: vi.fn(),
  error: vi.fn(),
};
const invokeTauriMock = vi.fn();
const waitForTauriBridgeMock = vi.fn(async () => true);

void vi.mock('@taskforceai/sync-client', () => ({
  createHttpSyncClient,
}));

void vi.mock('@taskforceai/web/app/lib/logger', () => ({
  logger: loggerMock,
}));

void vi.mock('./bridge', () => ({
  invokeTauri: invokeTauriMock,
  waitForTauriBridge: waitForTauriBridgeMock,
}));

describe('createDesktopSyncClient', () => {
  const baseUrl = 'https://sync.example.com';
  const getToken = () => 'token';
  const createSyncClient = async (
    options?: Parameters<(typeof import('./sync-client'))['createDesktopSyncClient']>[2]
  ): Promise<SyncClient> => {
    const { createDesktopSyncClient } = await import('./sync-client');
    return createDesktopSyncClient(baseUrl, getToken, options);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    invokeTauriMock.mockReset();
    waitForTauriBridgeMock.mockReset();
    waitForTauriBridgeMock.mockResolvedValue(true);
    httpClient.pull.mockReset();
    httpClient.push.mockReset();
    httpClient.getStatus.mockReset();
    httpClient.connectRealtime.mockReset();
  });

  it('uses the tauri bridge for pull when available', async () => {
    const pullResponse: SyncPullResponse = {
      conversations: [],
      messages: [],
      deletions: [],
      latest_version: 2,
    };
    invokeTauriMock.mockResolvedValueOnce(pullResponse);
    httpClient.pull.mockResolvedValue({
      conversations: [],
      messages: [],
      deletions: [],
      latest_version: 1,
    } satisfies SyncPullResponse);

    const client = await createSyncClient();
    const result = await client.pull(1, 'device-1');

    expect(result).toEqual(pullResponse);
    expect(invokeTauriMock).toHaveBeenCalledWith('app_server_desktop_sync_pull', {
      lastSyncVersion: 1,
      deviceId: 'device-1',
    });
    expect(httpClient.pull).not.toHaveBeenCalled();
  });

  it('falls back to HTTP sync when the Tauri bridge is unavailable', async () => {
    const pushResponse: SyncPushResponse = {
      accepted: [],
      conflicts: [],
      new_version: 3,
      conversation_id_mappings: {},
    };
    waitForTauriBridgeMock.mockResolvedValueOnce(false);
    httpClient.push.mockResolvedValue(pushResponse);

    const conversationPayload: ConversationSyncPayload = {
      id: 1,
      timestamp: '2025-01-01T00:00:00Z',
      user_input: 'Hello',
      sync_version: 1,
      last_synced_at: '2025-01-01T00:00:00Z',
      is_deleted: false,
      updated_at: '2025-01-01T00:00:00Z',
    };

    const messagePayload: MessageSyncPayload = {
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
    };

    const deletion: DeletionRecord = {
      type: 'conversation',
      id: 'conv-1',
      deleted_at: '2025-01-01T00:00:00Z',
    };

    const client = await createSyncClient();
    const result = await client.push(
      [conversationPayload],
      [messagePayload],
      [deletion],
      'device-1'
    );

    expect(result).toEqual(pushResponse);
    expect(invokeTauriMock).not.toHaveBeenCalled();
    expect(httpClient.push).toHaveBeenCalledTimes(1);
    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
    expect(loggerMock.error).not.toHaveBeenCalled();
  });

  it('forwards status and realtime wiring to the HTTP client', async () => {
    const status = { last_synced_at: '2025-01-01T00:00:00Z', sync_version: 1, pending_changes: 0 };
    const onEvent = vi.fn();
    const broadcastEvent: BroadcastEvent = {
      type: 'sync:required',
      userId: 'user-1',
    };

    httpClient.getStatus.mockResolvedValue(status);
    httpClient.connectRealtime.mockImplementation((handler: (event: BroadcastEvent) => void) => {
      handler(broadcastEvent);
      return () => {};
    });

    const client = await createSyncClient();

    expect(await client.getStatus()).toEqual(status);
    client.connectRealtime(onEvent);

    expect(httpClient.connectRealtime).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(broadcastEvent);
  });
  it('passes HTTP client options through to the fallback client', () => {
    const onUnauthorized = vi.fn();
    const getCsrfToken = vi.fn();
    const metrics = {
      incrementCounter: vi.fn(),
      startTimer: vi.fn(() => () => {}),
    };
    return import('./sync-client').then(({ createDesktopSyncClient }) => {
      createDesktopSyncClient(baseUrl, getToken, {
        onUnauthorized,
        getCsrfToken,
        metrics,
        isProduction: true,
      });

      expect(createHttpSyncClient).toHaveBeenCalledWith(
        baseUrl,
        getToken,
        expect.objectContaining({ onUnauthorized, getCsrfToken, metrics, isProduction: true })
      );
    });
  });

  it('falls back to HTTP sync when the Tauri bridge is unavailable for pull', async () => {
    const pullResponse: SyncPullResponse = {
      conversations: [],
      messages: [],
      deletions: [],
      latest_version: 2,
    };
    waitForTauriBridgeMock.mockResolvedValueOnce(false);
    httpClient.pull.mockResolvedValue(pullResponse);

    const client = await createSyncClient();
    const result = await client.pull(1, 'device-1');

    expect(result).toEqual(pullResponse);
    expect(invokeTauriMock).not.toHaveBeenCalled();
    expect(httpClient.pull).toHaveBeenCalledWith(1, 'device-1', undefined);
    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
    expect(loggerMock.error).not.toHaveBeenCalled();
  });

  it('forwards request options when push falls back to HTTP sync', async () => {
    const pushResponse: SyncPushResponse = {
      accepted: [],
      conflicts: [],
      new_version: 4,
      conversation_id_mappings: {},
    };
    const requestOptions = { signal: new AbortController().signal };
    waitForTauriBridgeMock.mockResolvedValueOnce(false);
    httpClient.push.mockResolvedValue(pushResponse);

    const client = await createSyncClient();
    await client.push([], [], [], 'device-2', requestOptions);

    expect(httpClient.push).toHaveBeenCalledWith([], [], [], 'device-2', requestOptions);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      '[desktop-sync] Falling back to HTTP sync - Tauri bridge unavailable',
      expect.objectContaining({ command: 'app_server_desktop_sync_push' })
    );
  });

  it('does not retry an ambiguous Tauri push failure over HTTP', async () => {
    invokeTauriMock.mockRejectedValueOnce(new Error('response lost'));
    const client = await createSyncClient();

    await expect(client.push([], [], [], 'device-3')).rejects.toThrow('response lost');

    expect(httpClient.push).not.toHaveBeenCalled();
  });

  it('forwards request options to HTTP status checks', async () => {
    const status = { last_synced_at: '', sync_version: 0, pending_changes: 2 };
    const requestOptions = { signal: new AbortController().signal };
    httpClient.getStatus.mockResolvedValue(status);

    const client = await createSyncClient();

    expect(await client.getStatus(requestOptions)).toEqual(status);
    expect(httpClient.getStatus).toHaveBeenCalledWith(requestOptions);
  });
});
