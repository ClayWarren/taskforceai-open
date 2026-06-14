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

void vi.mock('@taskforceai/sync-client', () => ({
  createHttpSyncClient,
}));

void vi.mock('../../logger', () => ({
  logger: loggerMock,
}));

void vi.mock('./bridge', () => ({
  invokeTauri: invokeTauriMock,
}));

describe('createDesktopSyncClient', () => {
  const baseUrl = 'https://sync.example.com';
  const getToken = () => 'token';
  const createSyncClient = async (): Promise<SyncClient> => {
    const { createDesktopSyncClient } = await import('./sync-client');
    return createDesktopSyncClient(baseUrl, getToken);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    invokeTauriMock.mockReset();
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

  it('falls back to HTTP sync when tauri push fails', async () => {
    const pushResponse: SyncPushResponse = {
      accepted: [],
      conflicts: [],
      new_version: 3,
      conversation_id_mappings: {},
    };
    invokeTauriMock.mockRejectedValueOnce(new Error('IPC failed'));
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
    expect(invokeTauriMock).toHaveBeenCalledWith('app_server_desktop_sync_push', {
      conversations: [conversationPayload],
      messages: [messagePayload],
      deletions: [deletion],
      deviceId: 'device-1',
    });
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
  it('passes onUnauthorized option to HTTP client', () => {
    const onUnauthorized = vi.fn();
    return import('./sync-client').then(({ createDesktopSyncClient }) => {
      createDesktopSyncClient(baseUrl, getToken, { onUnauthorized });

      expect(createHttpSyncClient).toHaveBeenCalledWith(
        baseUrl,
        getToken,
        expect.objectContaining({ onUnauthorized })
      );
    });
  });

  it('falls back to HTTP sync when tauri pull fails', async () => {
    const pullResponse: SyncPullResponse = {
      conversations: [],
      messages: [],
      deletions: [],
      latest_version: 2,
    };
    invokeTauriMock.mockRejectedValueOnce(new Error('IPC failed'));
    httpClient.pull.mockResolvedValue(pullResponse);

    const client = await createSyncClient();
    const result = await client.pull(1, 'device-1');

    expect(result).toEqual(pullResponse);
    expect(invokeTauriMock).toHaveBeenCalledWith('app_server_desktop_sync_pull', {
      lastSyncVersion: 1,
      deviceId: 'device-1',
    });
    expect(httpClient.pull).toHaveBeenCalledWith(1, 'device-1');
    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
    expect(loggerMock.error).not.toHaveBeenCalled();
  });
});
