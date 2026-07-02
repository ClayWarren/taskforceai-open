import { beforeEach, describe, expect, it, vi } from 'bun:test';

const invokeTauriMock = vi.fn();

vi.mock('../platform/desktop/bridge', () => ({
  invokeTauri: invokeTauriMock,
}));

vi.mock('../logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('tauriStorage', () => {
  beforeEach(() => {
    invokeTauriMock.mockReset();
  });

  it('loads conversation lists and forwards optional limit', async () => {
    const { tauriStorage } = await import('./tauri-adapter');
    invokeTauriMock.mockResolvedValueOnce([
      {
        id: 3,
        conversationId: 'c1',
        title: 'Alpha',
        createdAt: 1,
        updatedAt: 2,
        lastMessagePreview: 'last',
        syncVersion: 4,
        lastSyncedAt: 5,
        deviceId: 'dev-a',
        isDeleted: false,
      },
    ]);

    const conversations = await tauriStorage.getConversations(10);

    expect(invokeTauriMock).toHaveBeenCalledWith('app_server_conversation_list', { limit: 10 });
    expect(conversations).toEqual([
      {
        id: 3,
        conversationId: 'c1',
        title: 'Alpha',
        createdAt: 1,
        updatedAt: 2,
        lastMessagePreview: 'last',
        syncVersion: 4,
        lastSyncedAt: 5,
        deviceId: 'dev-a',
        isDeleted: false,
      },
    ]);
  });

  it('applies conversation pagination when offset is provided', async () => {
    const { tauriStorage } = await import('./tauri-adapter');
    invokeTauriMock.mockResolvedValueOnce([
      {
        id: 1,
        conversationId: 'c1',
        title: 'One',
        createdAt: 1,
        updatedAt: 1,
        lastMessagePreview: null,
        syncVersion: 0,
        lastSyncedAt: 0,
        isDeleted: false,
      },
      {
        id: 2,
        conversationId: 'c2',
        title: 'Two',
        createdAt: 2,
        updatedAt: 2,
        lastMessagePreview: null,
        syncVersion: 0,
        lastSyncedAt: 0,
        isDeleted: false,
      },
      {
        id: 3,
        conversationId: 'c3',
        title: 'Three',
        createdAt: 3,
        updatedAt: 3,
        lastMessagePreview: null,
        syncVersion: 0,
        lastSyncedAt: 0,
        isDeleted: false,
      },
    ]);

    const conversations = await tauriStorage.getConversations(2, 1);

    expect(invokeTauriMock).toHaveBeenCalledWith('app_server_conversation_list', { limit: 3 });
    expect(conversations.map((conversation) => conversation.conversationId)).toEqual(['c2', 'c3']);
  });

  it('returns not found result when conversation is missing', async () => {
    const { tauriStorage } = await import('./tauri-adapter');
    invokeTauriMock.mockResolvedValueOnce(null);

    const result = await tauriStorage.getConversation('missing');

    expect(invokeTauriMock).toHaveBeenCalledWith('app_server_conversation_get', {
      conversationId: 'missing',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Conversation not found');
    }
  });

  it('serializes optional conversation fields during upsert', async () => {
    const { tauriStorage } = await import('./tauri-adapter');
    invokeTauriMock.mockResolvedValueOnce(undefined);

    await tauriStorage.upsertConversation({
      id: 7,
      conversationId: 'c7',
      title: 'Org chat',
      createdAt: 10,
      updatedAt: 20,
      lastMessagePreview: null,
      syncVersion: 2,
      lastSyncedAt: 3,
      deviceId: 'desktop-1',
      isDeleted: false,
    });

    expect(invokeTauriMock).toHaveBeenCalledWith('app_server_conversation_upsert', {
      conversation: {
        id: 7,
        conversationId: 'c7',
        title: 'Org chat',
        createdAt: 10,
        updatedAt: 20,
        lastMessagePreview: null,
        syncVersion: 2,
        lastSyncedAt: 3,
        deviceId: 'desktop-1',
        isDeleted: false,
      },
    });
  });

  it('supports deleting and replacing conversation ids', async () => {
    const { tauriStorage } = await import('./tauri-adapter');
    invokeTauriMock.mockResolvedValue(undefined);

    await tauriStorage.deleteConversation('old-c');
    await tauriStorage.deleteAllConversations?.();
    await tauriStorage.replaceConversationId('old-c', 'new-c');

    expect(invokeTauriMock).toHaveBeenNthCalledWith(1, 'app_server_conversation_delete', {
      conversationId: 'old-c',
    });
    expect(invokeTauriMock).toHaveBeenNthCalledWith(
      2,
      'app_server_conversation_delete_all',
      undefined
    );
    expect(invokeTauriMock).toHaveBeenNthCalledWith(3, 'app_server_conversation_replace_id', {
      oldId: 'old-c',
      newId: 'new-c',
    });
  });

  it('parses legacy JSON string arrays when loading messages', async () => {
    const { tauriStorage } = await import('./tauri-adapter');
    invokeTauriMock.mockResolvedValueOnce([
      {
        id: 1,
        messageId: 'm1',
        conversationId: 'c1',
        role: 'assistant',
        content: 'done',
        isStreaming: false,
        isAgentStatus: true,
        isLocalCommandOutput: true,
        elapsedSeconds: 12,
        createdAt: 1,
        updatedAt: 1,
        error: null,
        syncVersion: 0,
        lastSyncedAt: 0,
        isDeleted: false,
        deviceId: 'desktop-1',
        traceId: 'trace-load-1',
        agentStatuses: '[{"status":"done","agent_id":1}]',
        sources: '[{"url":"https://example.com","title":"Example"}]',
        toolEvents:
          '[{"agentLabel":"Agent 1","toolName":"search","arguments":{},"success":true,"durationMs":20}]',
      },
    ]);

    const messages = await tauriStorage.getMessages('c1');

    expect(invokeTauriMock).toHaveBeenCalledWith('app_server_message_list', {
      conversationId: 'c1',
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      id: 1,
      messageId: 'm1',
      conversationId: 'c1',
      role: 'assistant',
      content: 'done',
      isStreaming: false,
      isAgentStatus: true,
      isLocalCommandOutput: true,
      elapsedSeconds: 12,
      createdAt: 1,
      updatedAt: 1,
      sources: [{ url: 'https://example.com', title: 'Example' }],
      toolEvents: [
        {
          agentLabel: 'Agent 1',
          toolName: 'search',
          arguments: {},
          success: true,
          durationMs: 20,
        },
      ],
      agentStatuses: [{ status: 'done', agent_id: 1 }],
      traceId: 'trace-load-1',
      syncVersion: 0,
      lastSyncedAt: 0,
      deviceId: 'desktop-1',
      isDeleted: false,
    });
  });

  it('applies message pagination in desktop adapter', async () => {
    const { tauriStorage } = await import('./tauri-adapter');
    invokeTauriMock.mockResolvedValueOnce([
      {
        id: 1,
        messageId: 'm1',
        conversationId: 'c1',
        role: 'assistant',
        content: 'one',
        isStreaming: false,
        createdAt: 1,
        updatedAt: 1,
        syncVersion: 0,
        lastSyncedAt: 0,
        isDeleted: false,
      },
      {
        id: 2,
        messageId: 'm2',
        conversationId: 'c1',
        role: 'assistant',
        content: 'two',
        isStreaming: false,
        createdAt: 2,
        updatedAt: 2,
        syncVersion: 0,
        lastSyncedAt: 0,
        isDeleted: false,
      },
      {
        id: 3,
        messageId: 'm3',
        conversationId: 'c1',
        role: 'assistant',
        content: 'three',
        isStreaming: false,
        createdAt: 3,
        updatedAt: 3,
        syncVersion: 0,
        lastSyncedAt: 0,
        isDeleted: false,
      },
    ]);

    const messages = await tauriStorage.getMessages('c1', 1, 1);

    expect(invokeTauriMock).toHaveBeenCalledWith('app_server_message_list', {
      conversationId: 'c1',
    });
    expect(messages.map((message) => message.messageId)).toEqual(['m2']);
  });

  it('returns not found result for missing messages', async () => {
    const { tauriStorage } = await import('./tauri-adapter');
    invokeTauriMock.mockResolvedValueOnce(null);

    const result = await tauriStorage.getMessage('m-missing');

    expect(invokeTauriMock).toHaveBeenCalledWith('app_server_message_get', {
      messageId: 'm-missing',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Message not found');
    }
  });

  it('serializes message fields for upsert and forwards delete', async () => {
    const { tauriStorage } = await import('./tauri-adapter');
    invokeTauriMock.mockResolvedValue(undefined);

    await tauriStorage.upsertMessage({
      id: 9,
      messageId: 'm9',
      conversationId: 'c9',
      role: 'assistant',
      content: 'done',
      isStreaming: false,
      isAgentStatus: true,
      elapsedSeconds: 8,
      createdAt: 11,
      updatedAt: 12,
      error: 'none',
      sources: [{ url: 'https://example.com' }],
      toolEvents: [],
      agentStatuses: [{ status: 'completed', agent_id: 1 }],
      traceId: 'trace-upsert-1',
      syncVersion: 1,
      lastSyncedAt: 1,
      deviceId: 'dev-x',
      isDeleted: false,
    });
    await tauriStorage.deleteMessage('m9');

    expect(invokeTauriMock).toHaveBeenNthCalledWith(1, 'app_server_message_upsert', {
      message: {
        id: 9,
        messageId: 'm9',
        conversationId: 'c9',
        role: 'assistant',
        content: 'done',
        isStreaming: false,
        isAgentStatus: true,
        elapsedSeconds: 8,
        createdAt: 11,
        updatedAt: 12,
        error: 'none',
        sources: [{ url: 'https://example.com' }],
        toolEvents: [],
        agentStatuses: [{ status: 'completed', agent_id: 1 }],
        traceId: 'trace-upsert-1',
        syncVersion: 1,
        lastSyncedAt: 1,
        deviceId: 'dev-x',
        isDeleted: false,
      },
    });
    expect(invokeTauriMock).toHaveBeenNthCalledWith(2, 'app_server_message_delete', {
      messageId: 'm9',
    });
  });

  it('maps pending changes and forwards pending change lifecycle commands', async () => {
    const { tauriStorage } = await import('./tauri-adapter');
    invokeTauriMock
      .mockResolvedValueOnce({
        pendingChanges: [
          {
            id: 4,
            type: 'conversation',
            entityId: 'c4',
            operation: 'create',
            data: { prompt: 'Ship' },
            createdAt: 10,
          },
        ],
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        pendingChanges: [
          {
            id: 5,
            type: 'conversation',
            entityId: 'c5',
            operation: 'update',
            data: { prompt: 'Ship', status: 'pending' },
            createdAt: 11,
          },
        ],
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        pendingChanges: [
          {
            id: 5,
            type: 'conversation',
            entityId: 'c5',
            operation: 'update',
            data: { prompt: 'Ship', status: 'failed' },
            createdAt: 11,
          },
        ],
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    const pending = await tauriStorage.getPendingChanges();
    await tauriStorage.addPendingChange({
      id: 5,
      type: 'conversation',
      entityId: 'c5',
      operation: 'update',
      data: { status: 'pending' },
      createdAt: 11,
    });
    await tauriStorage.updatePendingChange(5, { status: 'failed' });
    await tauriStorage.updatePendingChangeData(5, { status: 'queued' });
    await tauriStorage.removePendingChange(5);
    await tauriStorage.clearPendingChanges();

    expect(pending).toEqual([
      {
        id: 4,
        type: 'conversation',
        entityId: 'c4',
        operation: 'create',
        data: { prompt: 'Ship' },
        createdAt: 10,
      },
    ]);
    expect(invokeTauriMock).toHaveBeenNthCalledWith(1, 'app_server_pending_change_list', undefined);
    expect(invokeTauriMock).toHaveBeenNthCalledWith(2, 'app_server_pending_change_add', {
      change: {
        id: 5,
        type: 'conversation',
        entityId: 'c5',
        operation: 'update',
        data: { status: 'pending' },
        createdAt: 11,
      },
    });
    expect(invokeTauriMock).toHaveBeenNthCalledWith(3, 'app_server_pending_change_list', undefined);
    expect(invokeTauriMock).toHaveBeenNthCalledWith(4, 'app_server_pending_change_update_data', {
      id: 5,
      data: { prompt: 'Ship', status: 'failed' },
    });
    expect(invokeTauriMock).toHaveBeenNthCalledWith(5, 'app_server_pending_change_list', undefined);
    expect(invokeTauriMock).toHaveBeenNthCalledWith(6, 'app_server_pending_change_update_data', {
      id: 5,
      data: { prompt: 'Ship', status: 'queued' },
    });
    expect(invokeTauriMock).toHaveBeenNthCalledWith(7, 'app_server_pending_change_delete', {
      id: 5,
    });
    expect(invokeTauriMock).toHaveBeenNthCalledWith(
      8,
      'app_server_pending_change_clear',
      undefined
    );
  });

  it('handles sync metadata getters and setters', async () => {
    const { tauriStorage } = await import('./tauri-adapter');
    invokeTauriMock
      .mockResolvedValueOnce({ lastSyncVersion: 123, configured: true })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ deviceId: 'device-1', generated: false })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    const version = await tauriStorage.getLastSyncVersion();
    await tauriStorage.setLastSyncVersion(999);
    const deviceId = await tauriStorage.getDeviceId();
    await tauriStorage.setDeviceId('device-2');
    await tauriStorage.clearAll();

    expect(version).toBe(123);
    expect(deviceId).toBe('device-1');
    expect(invokeTauriMock).toHaveBeenNthCalledWith(1, 'app_server_sync_status', undefined);
    expect(invokeTauriMock).toHaveBeenNthCalledWith(2, 'app_server_sync_configure', {
      lastSyncVersion: 999,
    });
    expect(invokeTauriMock).toHaveBeenNthCalledWith(3, 'app_server_sync_ensure_device', undefined);
    expect(invokeTauriMock).toHaveBeenNthCalledWith(4, 'app_server_sync_configure', {
      deviceId: 'device-2',
    });
    expect(invokeTauriMock).toHaveBeenNthCalledWith(5, 'app_server_metadata_clear_all', undefined);
  });

  it('throws if storage does not return a device id', async () => {
    const { tauriStorage } = await import('./tauri-adapter');
    invokeTauriMock.mockResolvedValueOnce(null);

    await tauriStorage.getDeviceId().then(
      () => {
        throw new Error('Expected getDeviceId to reject when no device ID is returned');
      },
      (error: unknown) => {
        if (!(error instanceof Error)) {
          throw new Error('Expected an Error to be thrown when no device ID is returned');
        }
        expect(error.message).toContain('Desktop storage did not return a device ID');
      }
    );
  });
});
