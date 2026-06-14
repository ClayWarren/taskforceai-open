import { describe, expect, it } from 'bun:test';
import { SyncManager } from '@taskforceai/sync-client';

describe('MobileSyncClient Wrapper', () => {
  describe('SyncManager', () => {
    it('can be instantiated with mock client and storage', () => {
      const mockClient = {
        push: async () => ({ accepted: [], conflicts: [], conversationIdMappings: {}, newVersion: 100 }),
        pull: async () => ({ conversations: [], messages: [], deletions: [], latestVersion: 100 }),
      };

      const mockStorage = {
        getPendingChanges: async () => [],
        getDeviceId: async () => 'device-123',
        getLastSyncVersion: async () => 0,
      };

      const manager = new SyncManager({
        syncClient: mockClient as any,
        storage: mockStorage as any,
      });

      expect(manager).toBeDefined();
    });

    it('performs sync with empty state', async () => {
      const mockClient = {
        push: async () => ({ accepted: [], conflicts: [], conversationIdMappings: {}, newVersion: 100 }),
        pull: async () => ({ conversations: [], messages: [], deletions: [], latestVersion: 100 }),
      };

      const mockStorage = {
        getPendingChanges: async () => [],
        getDeviceId: async () => 'device-123',
        getConversation: async () => ({ ok: true, value: { conversationId: '1' } }),
        replaceConversationId: async () => {},
        setLastSyncVersion: async () => {},
        removePendingChange: async () => {},
        getLastSyncVersion: async () => 0,
        deleteConversation: async () => {},
        upsertConversation: async () => {},
        deleteMessage: async () => {},
        upsertMessage: async () => {},
        updateConversationMetadata: async () => {},
      };

      const manager = new SyncManager({
        syncClient: mockClient as any,
        storage: mockStorage as any,
      });

      const stats = await manager.sync();
      expect(stats.pushed.conversations).toBe(0);
      expect(stats.pulled.conversations).toBe(0);
    });
  });
});
