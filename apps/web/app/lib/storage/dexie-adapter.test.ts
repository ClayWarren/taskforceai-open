import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';
import Dexie from 'dexie';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';

import '../../../../../tests/setup/dom';

// Now import the adapter (it will use the mocked db)
import { DexieStorageAdapter } from './dexie-adapter';

// Setup Mock DB Class
class MockTaskForceDB extends Dexie {
  conversations: Dexie.Table<any, number>;
  messages: Dexie.Table<any, number>;
  pendingPrompts: Dexie.Table<any, number>;

  constructor() {
    super('MockTaskForceDB', { indexedDB: indexedDB, IDBKeyRange: IDBKeyRange });
    this.version(1).stores({
      messages: '++id,&messageId,conversationId,createdAt,role,[conversationId+createdAt]',
      conversations: '++id,&conversationId,updatedAt',
      pendingPrompts: '++id,conversationId,status,createdAt',
    });
    this.conversations = this.table('conversations');
    this.messages = this.table('messages');
    this.pendingPrompts = this.table('pendingPrompts');
  }
}

const mockDb = new MockTaskForceDB();

// Mock the dexie-db module
let dexieReadyStub = true;
mock.module('@taskforceai/web/lib/dexie-db', () => {
  return {
    db: mockDb,
    ensureDexieReady: async () => dexieReadyStub,
    isDexieAvailable: () => dexieReadyStub,
  };
});

// Mock policy manager (getPolicy is used in some code paths even if not subscribed)
mock.module('#qa/policyManager', () => ({
  getPolicy: () => ({
    dexie: {
      retry: { attempts: 2, baseDelayMs: 1, jitterMs: 0 },
    },
  }),
  subscribeToPolicy: () => () => {},
}));

const mockStorage = new Map<string, string>();

describe('DexieStorageAdapter', () => {
  let adapter: DexieStorageAdapter;

  beforeEach(async () => {
    vi.clearAllMocks();

    vi.spyOn(localStorage, 'getItem').mockImplementation(
      (key: string) => mockStorage.get(key) ?? null
    );
    vi.spyOn(localStorage, 'setItem').mockImplementation((key: string, value: string) => {
      mockStorage.set(key, value);
    });
    vi.spyOn(localStorage, 'removeItem').mockImplementation((key: string) => {
      mockStorage.delete(key);
    });
    vi.spyOn(localStorage, 'clear').mockImplementation(() => {
      mockStorage.clear();
    });

    await mockDb.delete();
    await mockDb.open();
    await mockDb.table('conversations').clear();
    await mockDb.table('messages').clear();
    await mockDb.table('pendingPrompts').clear();

    mockStorage.clear();

    dexieReadyStub = true;
    adapter = new DexieStorageAdapter();
  });

  describe('Conversations', () => {
    it('upserts and retrieves a conversation', async () => {
      const conv = {
        conversationId: 'c1',
        title: 'Test',
        createdAt: 100,
        updatedAt: 200,
        lastMessagePreview: 'preview',
        syncVersion: 0,
        lastSyncedAt: 0,
        isDeleted: false,
      };

      await adapter.upsertConversation(conv);

      const retrieved = await adapter.getConversation('c1');
      expect(retrieved.ok).toBe(true);
      if (retrieved.ok) {
        expect(retrieved.value.conversationId).toBe('c1');
        expect(retrieved.value.title).toBe('Test');
      }
    });

    it('updates an existing conversation', async () => {
      const conv = {
        conversationId: 'c1',
        title: 'Test 1',
        createdAt: 100,
        updatedAt: 200,
        syncVersion: 0,
        lastSyncedAt: 0,
        isDeleted: false,
      };
      await adapter.upsertConversation(conv);

      const updated = { ...conv, title: 'Test 2', updatedAt: 300 };
      await adapter.upsertConversation(updated);

      const retrieved = await adapter.getConversation('c1');
      if (retrieved.ok) {
        expect(retrieved.value.title).toBe('Test 2');
        expect(retrieved.value.updatedAt).toBe(300);
      }

      const list = await adapter.getConversations();
      expect(list).toHaveLength(1);
    });

    it('separates active and archived conversation lists', async () => {
      await adapter.upsertConversation({
        conversationId: 'active-1',
        title: 'Active',
        createdAt: 100,
        updatedAt: 300,
        syncVersion: 0,
        lastSyncedAt: 0,
        isDeleted: false,
      });
      await adapter.upsertConversation({
        conversationId: 'archived-1',
        title: 'Archived',
        createdAt: 50,
        updatedAt: 200,
        syncVersion: 0,
        lastSyncedAt: 0,
        isDeleted: false,
        isArchived: true,
      });

      const active = await adapter.getConversations();
      const archived = await adapter.getArchivedConversations();

      expect(active.map((conversation) => conversation.conversationId)).toEqual(['active-1']);
      expect(archived.map((conversation) => conversation.conversationId)).toEqual(['archived-1']);
    });

    it('archives and deletes all local conversations', async () => {
      await adapter.upsertConversation({
        conversationId: 'c1',
        title: 'First',
        createdAt: 100,
        updatedAt: 100,
        syncVersion: 0,
        lastSyncedAt: 0,
        isDeleted: false,
      });
      await adapter.upsertConversation({
        conversationId: 'c2',
        title: 'Second',
        createdAt: 200,
        updatedAt: 200,
        syncVersion: 0,
        lastSyncedAt: 0,
        isDeleted: false,
      });
      await adapter.upsertMessage({
        messageId: 'm1',
        conversationId: 'c1',
        role: 'user',
        content: 'hi',
        isStreaming: false,
        createdAt: 100,
        updatedAt: 100,
        syncVersion: 0,
        lastSyncedAt: 0,
        isDeleted: false,
      });

      await adapter.archiveAllConversations();
      expect(await adapter.getConversations()).toHaveLength(0);
      expect(await adapter.getArchivedConversations()).toHaveLength(2);

      await adapter.deleteAllConversations();
      expect(await adapter.getArchivedConversations()).toHaveLength(0);
      expect(await adapter.getMessages('c1')).toHaveLength(0);
    });

    it('deletes a conversation and its messages', async () => {
      await adapter.upsertConversation({
        conversationId: 'c1',
        title: 'Del',
        createdAt: 1,
        updatedAt: 1,
        syncVersion: 0,
        lastSyncedAt: 0,
        isDeleted: false,
      });
      await adapter.upsertMessage({
        messageId: 'm1',
        conversationId: 'c1',
        role: 'user',
        content: 'hi',
        isStreaming: false,
        createdAt: 1,
        updatedAt: 1,
        syncVersion: 0,
        lastSyncedAt: 0,
        isDeleted: false,
      });

      await adapter.deleteConversation('c1');

      const cResult = await adapter.getConversation('c1');
      expect(cResult.ok).toBe(false);

      const mResult = await adapter.getMessages('c1');
      expect(mResult).toHaveLength(0);
    });
  });

  describe('Messages', () => {
    const msg = {
      messageId: 'm1',
      conversationId: 'c1',
      role: 'user' as const,
      content: 'hello',
      isStreaming: false,
      createdAt: 100,
      updatedAt: 100,
      syncVersion: 0,
      lastSyncedAt: 0,
      isDeleted: false,
    };

    it('upserts and retrieves a message', async () => {
      await adapter.upsertMessage(msg);

      const retrieved = await adapter.getMessage('m1');
      expect(retrieved.ok).toBe(true);
      if (retrieved.ok) {
        expect(retrieved.value.content).toBe('hello');
      }
    });

    it('gets messages for conversation sorted by date', async () => {
      await adapter.upsertMessage({ ...msg, messageId: 'm2', createdAt: 200, content: 'second' });
      await adapter.upsertMessage({ ...msg, messageId: 'm1', createdAt: 100, content: 'first' });

      const list = await adapter.getMessages('c1');
      expect(list).toHaveLength(2);
      const first = list[0];
      const second = list[1];
      expect(first).toBeDefined();
      expect(second).toBeDefined();
      if (!first || !second) return;
      expect(first.content).toBe('first');
      expect(second.content).toBe('second');
    });

    it('deletes a message', async () => {
      await adapter.upsertMessage(msg);
      await adapter.deleteMessage('m1');

      const result = await adapter.getMessage('m1');
      expect(result.ok).toBe(false);
    });
  });

  describe('Pending Changes', () => {
    it('manages pending changes lifecycle', async () => {
      const change = {
        type: 'prompt' as const,
        entityId: 'c-new',
        operation: 'create' as const,
        data: { prompt: 'new prompt', status: 'queued' },
        createdAt: 1000,
      };

      await adapter.addPendingChange(change);

      const list = await adapter.getPendingChanges();

      // Depending on mapping, check results
      // mapToPendingChange maps back prompts
      // PendingPrompt structure: { id, conversationId, prompt, status, createdAt }
      // PendingChange structure: { type, entityId, operation, data, createdAt }

      expect(list.length).toBeGreaterThan(0);
      const item = list[0];
      expect(item).toBeDefined();
      if (!item) return;
      expect(item.type).toBe('prompt');
      expect(item.entityId).toBe('c-new');
      expect(item.data).toEqual({ prompt: 'new prompt', status: 'queued' });

      const id = item.id!;
      await adapter.updatePendingChange(id, { status: 'failed' });

      await adapter.removePendingChange(id);
      const list3 = await adapter.getPendingChanges();
      expect(list3).toHaveLength(0);
    });

    it('clears all pending changes', async () => {
      // ... (as before)
      await adapter.addPendingChange({
        type: 'prompt',
        entityId: 'c1',
        operation: 'create',
        data: { prompt: 'p1' },
        createdAt: 1,
      });
      await adapter.clearPendingChanges();
      const list = await adapter.getPendingChanges();
      expect(list).toHaveLength(0);
    });
  });

  describe('Metadata', () => {
    it('sets and gets last sync version', async () => {
      await adapter.setLastSyncVersion(12345);
      const ver = await adapter.getLastSyncVersion();
      expect(ver).toBe(12345);
    });

    it('sets and gets device id', async () => {
      await adapter.setDeviceId('dev-123');
      const id = await adapter.getDeviceId();
      expect(id).toBe('dev-123');
    });
  });

  describe('Edge Cases and Errors', () => {
    it('returns empty/error when dexie is not ready', async () => {
      dexieReadyStub = false;

      expect(await adapter.getConversations()).toEqual([]);
      expect((await adapter.getConversation('any')).ok).toBe(false);
      expect(await adapter.getMessages('any')).toEqual([]);
      expect((await adapter.getMessage('any')).ok).toBe(false);
      expect(await adapter.getPendingChanges()).toEqual([]);

      // Void returns just return
      await adapter.upsertConversation({} as any);
      await adapter.deleteConversation('any');
      await adapter.addPendingChange({ type: 'conversation', operation: 'create' } as any);
      await adapter.updatePendingChange(1, {});
      await adapter.removePendingChange(1);
      await adapter.clearPendingChanges();
    });

    it('handles updatePendingChangeData', async () => {
      await adapter.addPendingChange({
        type: 'prompt',
        entityId: 'c1',
        operation: 'create',
        data: { prompt: 'p', runPayload: { prompt: 'p', demo: false, modelId: 'gpt-5' } },
        createdAt: 1,
      });
      const [item] = await adapter.getPendingChanges();
      expect(item).toBeDefined();
      if (!item) return;

      // With status
      await adapter.updatePendingChangeData(item.id!, { status: 'failed' });
      const dbItem = await mockDb.table('pendingPrompts').get(item.id!);
      expect(dbItem).toBeDefined();
      if (!dbItem) return;
      expect(dbItem.status).toBe('failed');

      // Without status or invalid status
      await adapter.updatePendingChangeData(item.id!, { foo: 'bar' });
      await adapter.updatePendingChangeData(item.id!, { status: 'invalid' });
      await adapter.updatePendingChangeData(item.id!, {
        runPayload: { prompt: 'p', demo: false, modelId: 'gpt-4.1' },
      });

      const updated = await adapter.getPendingChanges();
      expect(updated[0]?.data).toEqual({
        prompt: 'p',
        status: 'failed',
        runPayload: { prompt: 'p', demo: false, modelId: 'gpt-4.1' },
      });
    });

    it('clears all data', async () => {
      await adapter.upsertConversation({
        conversationId: 'c1',
        title: 'T',
        createdAt: 1,
        updatedAt: 1,
        syncVersion: 0,
        lastSyncedAt: 0,
        isDeleted: false,
      });
      await adapter.setLastSyncVersion(100);

      await adapter.clearAll();

      expect(await adapter.getConversations()).toHaveLength(0);
      expect(await adapter.getLastSyncVersion()).toBe(0);
    });

    it('triggers retry metrics', async () => {
      let calls = 0;
      // Mock getConversation which calls first()
      mockDb.conversations.where = function () {
        return {
          equals: () => ({
            first: async () => {
              calls++;
              if (calls === 1) throw new Error('Retryable');
              return {
                id: 1,
                conversationId: 'c1',
                title: 'T',
                updatedAt: 1,
                createdAt: 1,
                syncVersion: 0,
                lastSyncedAt: 0,
                isDeleted: false,
              };
            },
          }),
        } as any;
      };

      try {
        await adapter.getConversation('c1');
        expect(calls).toBe(2);
      } finally {
        delete (mockDb.conversations as any).where; // Restore
      }
    });

    // Note: policy updates test removed - DexieStorageAdapter doesn't subscribe to policy changes
  });
});
