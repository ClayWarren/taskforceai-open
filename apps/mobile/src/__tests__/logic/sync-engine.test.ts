import { describe, expect, it, mock, beforeEach } from 'bun:test';
import { SyncManager } from '@taskforceai/sync-client';

describe('SyncManager orchestration', () => {
  let mockClient: any;
  let mockStorage: any;
  let manager: SyncManager;

  beforeEach(() => {
    mockClient = {
      push: mock(async () => ({
        accepted: [],
        conflicts: [],
        conversationIdMappings: {},
        newVersion: 100
      })),
      pull: mock(async () => ({
        conversations: [],
        messages: [],
        deletions: [],
        latestVersion: 100
      }))
    };

    mockStorage = {
      getPendingChanges: mock(async () => []),
      getDeviceId: mock(async () => 'device-123'),
      getConversation: mock(async () => ({ ok: true, value: { conversationId: '1' } })),
      replaceConversationId: mock(async () => {}),
      setLastSyncVersion: mock(async () => {}),
      removePendingChange: mock(async () => {}),
      getLastSyncVersion: mock(async () => 0),
      deleteConversation: mock(async () => {}),
      upsertConversation: mock(async () => {}),
      deleteMessage: mock(async () => {}),
      upsertMessage: mock(async () => {}),
      updateConversationMetadata: mock(async () => {}),
    };

    manager = new SyncManager({
      syncClient: mockClient,
      storage: mockStorage
    });
  });

  it('handles empty sync', async () => {
    const stats = await manager.sync();
    expect(stats.pushed.conversations).toBe(0);
    expect(stats.pulled.conversations).toBe(0);
    expect(mockClient.push).not.toHaveBeenCalled();
    expect(mockClient.pull).toHaveBeenCalled();
  });

  it('pushes pending conversations', async () => {
    mockStorage.getPendingChanges.mockResolvedValueOnce([
      { id: 1, type: 'conversation', entityId: 'local-1', operation: 'create', data: { prompt: 'Hello', status: 'queued' }, createdAt: Date.now() }
    ]);
    
    mockClient.push.mockResolvedValueOnce({
      accepted: ['conversation:local-1'],
      conflicts: [],
      conversationIdMappings: { 'local-1': 'server-1' },
      newVersion: 5
    });

    const stats = await manager.sync();
    
    expect(stats.pushed.conversations).toBe(1);
    expect(mockStorage.replaceConversationId).toHaveBeenCalledWith('local-1', 'remote-server-1');
    expect(mockStorage.removePendingChange).toHaveBeenCalledWith(1);
  });

  it('handles remote conversations and messages during pull', async () => {
    mockClient.pull.mockResolvedValueOnce({
      conversations: [
        { id: 10, userInput: 'Hi', timestamp: new Date().toISOString(), updatedAt: new Date().toISOString(), lastSyncedAt: new Date().toISOString(), syncVersion: 1, isDeleted: false }
      ],
      messages: [
        { messageId: 'm1', conversationId: 10, role: 'user', content: 'Hey', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastSyncedAt: new Date().toISOString(), syncVersion: 1, isDeleted: false }
      ],
      deletions: [],
      latestVersion: 110
    });

    const stats = await manager.sync();
    
    expect(stats.pulled.conversations).toBe(1);
    expect(stats.pulled.messages).toBe(1);
    expect(mockStorage.upsertConversation).toHaveBeenCalled();
    expect(mockStorage.upsertMessage).toHaveBeenCalled();
  });

  it('resolves conflicts by accepted/rejected lists', async () => {
    // Shared logic uses accepted list to clear pending changes.
    const messageData = { 
      messageId: 'm-local', 
      conversationId: 42,
      content: 'test', 
      role: 'user',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    mockStorage.getPendingChanges.mockResolvedValueOnce([
      { id: 2, type: 'message', entityId: 'm-local', operation: 'create', data: messageData, createdAt: Date.now() }
    ]);
    
    const pushResult = {
      accepted: [], // not accepted = remains pending or handled as conflict
      conflicts: [{ type: 'message', id: 'm-local' }],
      conversationIdMappings: {},
      newVersion: 20
    };
    
    mockClient.push.mockResolvedValueOnce(pushResult);

    const stats = await manager.sync();
    
    expect(stats.conflicts).toBe(1);
    // SyncManager doesn't automatically remove conflicts from storage, 
    // it clears accepted. Unaccepted remain.
    expect(mockStorage.removePendingChange).not.toHaveBeenCalled();
  });
});
