import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import {
  conversationResultError,
  createStorageMock,
  type StorageAdapterMock,
} from '#tests/fixtures/sync-storage';
import { err, ok } from '@taskforceai/client-core/result';
import { ConversationStore } from './chat-conversation-store';

describe('persistence/chat-conversation-store', () => {
  let storage: StorageAdapterMock;
  let store: ConversationStore;

  beforeEach(() => {
    storage = createStorageMock();
    store = new ConversationStore(storage);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ensureConversation leaves existing non-default title untouched', async () => {
    const timestamp = 1710000000000;
    vi.spyOn(Date, 'now').mockReturnValue(timestamp);

    storage.getConversation.mockResolvedValueOnce(
      ok({
        conversationId: 'conv-1',
        title: 'Pinned Title',
        createdAt: 1,
        updatedAt: 2,
        lastMessagePreview: null,
        syncVersion: 0,
        lastSyncedAt: 0,
        isDeleted: false,
      })
    );

    await store.ensureConversation('conv-1', 'Suggested Title');

    expect(storage.upsertConversation).not.toHaveBeenCalled();
  });

  it('ensureConversation replaces default title and creates base conversation when missing', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1710000001000);

    storage.getConversation
      .mockResolvedValueOnce(
        ok({
          conversationId: 'conv-1',
          title: 'New Conversation',
          createdAt: 1,
          updatedAt: 2,
          lastMessagePreview: null,
          syncVersion: 0,
          lastSyncedAt: 0,
          isDeleted: false,
        })
      )
      .mockResolvedValueOnce(conversationResultError('NOT_FOUND'));

    await store.ensureConversation('conv-1', 'Renamed from Prompt');
    await store.ensureConversation('conv-2', 'Brand New');

    expect(storage.upsertConversation).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ title: 'Renamed from Prompt' })
    );
    expect(storage.upsertConversation).toHaveBeenNthCalledWith(2, {
      conversationId: 'conv-2',
      title: 'Brand New',
      createdAt: 1710000001000,
      updatedAt: 1710000001000,
      lastMessagePreview: null,
      syncVersion: 0,
      lastSyncedAt: 0,
      isDeleted: false,
    });
  });

  it('ensureConversation replaces an empty existing title', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1710000001500);
    storage.getConversation.mockResolvedValueOnce(
      ok({
        conversationId: 'conv-1',
        title: '',
        createdAt: 1,
        updatedAt: 2,
        lastMessagePreview: null,
        syncVersion: 0,
        lastSyncedAt: 0,
        isDeleted: false,
      })
    );

    await store.ensureConversation('conv-1', 'Prompt Title');

    expect(storage.upsertConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        title: 'Prompt Title',
        updatedAt: 1710000001500,
      })
    );
  });

  it('ensureConversation throws on storage error and does not create conversation', async () => {
    storage.getConversation.mockResolvedValueOnce(
      conversationResultError(new Error('storage down'))
    );

    await expect(store.ensureConversation('conv-err', 'Should Fail')).rejects.toThrow(
      'storage down'
    );
    expect(storage.upsertConversation).not.toHaveBeenCalled();
  });

  it('renameConversation no-ops when missing and updates when found', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1710000002000);

    storage.getConversation
      .mockResolvedValueOnce(conversationResultError('NOT_FOUND'))
      .mockResolvedValueOnce(
        ok({
          conversationId: 'conv-1',
          title: 'Old',
          createdAt: 1,
          updatedAt: 2,
          lastMessagePreview: null,
          syncVersion: 0,
          lastSyncedAt: 0,
          isDeleted: false,
        })
      );

    await store.renameConversation('conv-1', 'Will Not Apply');
    await store.renameConversation('conv-1', 'Applied Title');

    expect(storage.upsertConversation).toHaveBeenCalledTimes(1);
    expect(storage.upsertConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        title: 'Applied Title',
        updatedAt: 1710000002000,
      })
    );
  });

  it('setConversationProjectId updates the project assignment', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1710000002100);
    storage.getConversation.mockResolvedValueOnce(
      ok({
        conversationId: 'conv-1',
        title: 'Project chat',
        createdAt: 1,
        updatedAt: 2,
        lastMessagePreview: null,
        syncVersion: 0,
        lastSyncedAt: 0,
        isDeleted: false,
      })
    );

    await store.setConversationProjectId('conv-1', 17);

    expect(storage.upsertConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        projectId: 17,
        updatedAt: 1710000002100,
      })
    );
  });

  it('renameConversation throws on storage error', async () => {
    storage.getConversation.mockResolvedValueOnce(
      conversationResultError(new Error('database unavailable'))
    );

    await expect(store.renameConversation('conv-1', 'Renamed')).rejects.toThrow(
      'database unavailable'
    );
    expect(storage.upsertConversation).not.toHaveBeenCalled();
  });

  it('renameConversation does not treat storage messages containing not found as missing', async () => {
    storage.getConversation.mockResolvedValueOnce(
      conversationResultError(new Error('IndexedDB object store was not found'))
    );

    await expect(store.renameConversation('conv-1', 'Ignored')).rejects.toThrow(
      'IndexedDB object store was not found'
    );

    expect(storage.upsertConversation).not.toHaveBeenCalled();
  });

  it('archiveConversation marks an existing conversation archived without deleting it', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1710000002500);
    storage.getConversation.mockResolvedValueOnce(
      ok({
        conversationId: 'conv-1',
        title: 'Active',
        createdAt: 1,
        updatedAt: 2,
        lastMessagePreview: null,
        syncVersion: 0,
        lastSyncedAt: 0,
        isDeleted: false,
      })
    );

    await store.archiveConversation('conv-1');

    expect(storage.upsertConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        isArchived: true,
        updatedAt: 1710000002500,
      })
    );
    expect(storage.deleteConversation).not.toHaveBeenCalled();
  });

  it('restoreConversation clears archive state without deleting the conversation', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1710000002600);
    storage.getConversation.mockResolvedValueOnce(
      ok({
        conversationId: 'conv-1',
        title: 'Archived',
        createdAt: 1,
        updatedAt: 2,
        lastMessagePreview: null,
        syncVersion: 0,
        lastSyncedAt: 0,
        isDeleted: false,
        isArchived: true,
      })
    );

    await store.restoreConversation('conv-1');

    expect(storage.upsertConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        isArchived: false,
        updatedAt: 1710000002600,
      })
    );
    expect(storage.deleteConversation).not.toHaveBeenCalled();
  });

  it('lists archived conversations through the adapter archive query', async () => {
    storage.getArchivedConversations.mockResolvedValueOnce([
      {
        conversationId: 'conv-archived',
        title: 'Archived',
        createdAt: 1,
        updatedAt: 2,
        lastMessagePreview: null,
        syncVersion: 0,
        lastSyncedAt: 0,
        isDeleted: false,
        isArchived: true,
      },
    ]);

    const archived = await store.listArchivedConversations(10, 5);

    expect(storage.getArchivedConversations).toHaveBeenCalledWith(10, 5);
    expect(archived).toEqual([
      expect.objectContaining({
        conversationId: 'conv-archived',
        isArchived: true,
      }),
    ]);
  });

  it('delegates archive all and delete all when the adapter supports bulk operations', async () => {
    await store.archiveAllConversations();
    await store.deleteAllConversations();

    expect(storage.archiveAllConversations).toHaveBeenCalled();
    expect(storage.deleteAllConversations).toHaveBeenCalled();
  });

  it('falls back to per-conversation archive and delete when bulk operations are unavailable', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1710000002700);
    delete (storage as Partial<StorageAdapterMock>).archiveAllConversations;
    delete (storage as Partial<StorageAdapterMock>).deleteAllConversations;
    const active = {
      conversationId: 'conv-active',
      title: 'Active',
      createdAt: 1,
      updatedAt: 2,
      lastMessagePreview: null,
      syncVersion: 0,
      lastSyncedAt: 0,
      isDeleted: false,
    };
    const archived = {
      ...active,
      conversationId: 'conv-archived',
      title: 'Archived',
      isArchived: true,
    };

    storage.getConversations.mockResolvedValueOnce([active]).mockResolvedValueOnce([active]);
    storage.getArchivedConversations.mockResolvedValueOnce([archived, active]);

    await store.archiveAllConversations();
    await store.deleteAllConversations();

    expect(storage.upsertConversation).toHaveBeenCalledWith({
      ...active,
      isArchived: true,
      updatedAt: 1710000002700,
    });
    expect(storage.deleteConversation).toHaveBeenCalledTimes(2);
    expect(storage.deleteConversation).toHaveBeenCalledWith('conv-active');
    expect(storage.deleteConversation).toHaveBeenCalledWith('conv-archived');
  });

  it('getConversation maps not found and storage errors', async () => {
    storage.getConversation
      .mockResolvedValueOnce(conversationResultError('NOT_FOUND'))
      .mockResolvedValueOnce(conversationResultError('Conversation Not Found in adapter'))
      .mockResolvedValueOnce(conversationResultError(new Error('database unavailable')))
      .mockResolvedValueOnce(
        ok({
          id: 9,
          conversationId: 'conv-1',
          title: 'Title',
          createdAt: 1,
          updatedAt: 2,
          lastMessagePreview: 'preview',
          syncVersion: 4,
          lastSyncedAt: 5,
          deviceId: 'dev-1',
          isDeleted: true,
        })
      );

    const notFound = await store.getConversation('conv-1');
    expect(notFound).toEqual(err({ kind: 'not_found', message: 'Conversation not found' }));

    const fromMessage = await store.getConversation('conv-1');
    expect(fromMessage).toEqual(
      err({ kind: 'storage', message: 'Conversation Not Found in adapter' })
    );

    const storageError = await store.getConversation('conv-1');
    expect(storageError).toEqual(err({ kind: 'storage', message: 'database unavailable' }));

    const found = await store.getConversation('conv-1');
    expect(found).toEqual(
      ok({
        conversationId: 'conv-1',
        title: 'Title',
        createdAt: 1,
        updatedAt: 2,
        lastMessagePreview: 'preview',
        syncVersion: 4,
        lastSyncedAt: 5,
        deviceId: 'dev-1',
        isDeleted: true,
      })
    );
  });

  it('lists and clears conversations through adapter', async () => {
    storage.getConversations.mockResolvedValueOnce([
      {
        conversationId: 'conv-1',
        title: 'One',
        createdAt: 1,
        updatedAt: 2,
        lastMessagePreview: null,
        syncVersion: 0,
        lastSyncedAt: 0,
        isDeleted: false,
      },
      {
        conversationId: 'conv-2',
        title: 'Two',
        createdAt: 3,
        updatedAt: 4,
        lastMessagePreview: 'preview',
        syncVersion: 3,
        lastSyncedAt: 7,
        deviceId: 'device-z',
        isDeleted: true,
      },
    ]);

    const listed = await store.listConversations(10);
    expect(storage.getConversations).toHaveBeenCalledWith(10, 0);
    expect(listed).toEqual([
      {
        conversationId: 'conv-1',
        title: 'One',
        createdAt: 1,
        updatedAt: 2,
        lastMessagePreview: null,
        syncVersion: 0,
        lastSyncedAt: 0,
        isDeleted: false,
      },
      {
        conversationId: 'conv-2',
        title: 'Two',
        createdAt: 3,
        updatedAt: 4,
        lastMessagePreview: 'preview',
        syncVersion: 3,
        lastSyncedAt: 7,
        deviceId: 'device-z',
        isDeleted: true,
      },
    ]);

    await store.clearConversation('conv-2');
    expect(storage.deleteConversation).toHaveBeenCalledWith('conv-2');
  });

  it('replaces conversation ids and no-ops when ids already match', async () => {
    await store.replaceConversationId('conv-1', 'conv-2');
    await store.replaceConversationId('conv-2', 'conv-2');

    expect(storage.replaceConversationId).toHaveBeenCalledTimes(1);
    expect(storage.replaceConversationId).toHaveBeenCalledWith('conv-1', 'conv-2');
  });

  it('updates lastMessagePreview and metadata only when conversation exists', async () => {
    const timestamp = 1710000003000;
    vi.spyOn(Date, 'now').mockReturnValue(timestamp);

    storage.getConversation
      .mockResolvedValueOnce(conversationResultError('NOT_FOUND'))
      .mockResolvedValueOnce(
        ok({
          conversationId: 'conv-1',
          title: 'Conversation',
          createdAt: 1,
          updatedAt: 2,
          lastMessagePreview: null,
          syncVersion: 0,
          lastSyncedAt: 0,
          isDeleted: false,
        })
      )
      .mockResolvedValueOnce(
        ok({
          conversationId: 'conv-1',
          title: 'Conversation',
          createdAt: 1,
          updatedAt: 2,
          lastMessagePreview: null,
          syncVersion: 0,
          lastSyncedAt: 0,
          isDeleted: false,
        })
      );

    const missing = await store.updateLastMessagePreview('conv-1', 'ignored', timestamp);
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error).toEqual({
        kind: 'not_found',
        message: 'Conversation not found',
      });
    }

    const longContent = `${'x'.repeat(260)} trailer`;
    const updated = await store.updateLastMessagePreview('conv-1', longContent, timestamp);
    expect(updated.ok).toBe(true);
    expect(storage.upsertConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        updatedAt: timestamp,
        lastMessagePreview: expect.stringMatching(/…$/),
      })
    );

    const metadataResult = await store.updateConversationMetadata('conv-1', (conversation) => ({
      ...conversation,
      title: 'Metadata Updated',
      lastSyncedAt: 99,
    }));

    expect(metadataResult.ok).toBe(true);
    expect(storage.upsertConversation).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Metadata Updated', lastSyncedAt: 99 })
    );
    expect(metadataResult).toEqual(
      ok(
        expect.objectContaining({
          title: 'Metadata Updated',
          lastSyncedAt: 99,
        })
      )
    );
  });

  it('does not move lastMessagePreview backwards for older messages', async () => {
    storage.getConversation.mockResolvedValueOnce(
      ok({
        conversationId: 'conv-1',
        title: 'Conversation',
        createdAt: 1,
        updatedAt: 200,
        lastMessagePreview: 'newer preview',
        syncVersion: 0,
        lastSyncedAt: 0,
        isDeleted: false,
      })
    );

    const result = await store.updateLastMessagePreview('conv-1', 'older message', 100);

    expect(result).toEqual(
      ok(
        expect.objectContaining({
          updatedAt: 200,
          lastMessagePreview: 'newer preview',
        })
      )
    );
    expect(storage.upsertConversation).not.toHaveBeenCalled();
  });

  it('fills an empty preview without moving updatedAt backwards', async () => {
    storage.getConversation.mockResolvedValueOnce(
      ok({
        conversationId: 'conv-1',
        title: 'Conversation',
        createdAt: 1,
        updatedAt: 200,
        lastMessagePreview: null,
        syncVersion: 0,
        lastSyncedAt: 0,
        isDeleted: false,
      })
    );

    const result = await store.updateLastMessagePreview('conv-1', 'first preview', 100);

    expect(result).toEqual(
      ok(
        expect.objectContaining({
          updatedAt: 200,
          lastMessagePreview: 'first preview',
        })
      )
    );
    expect(storage.upsertConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        updatedAt: 200,
        lastMessagePreview: 'first preview',
      })
    );
  });

  it('returns missing result when updating metadata for a missing conversation', async () => {
    storage.getConversation.mockResolvedValueOnce(conversationResultError('NOT_FOUND'));

    const result = await store.updateConversationMetadata('conv-missing', (conversation) => ({
      ...conversation,
      title: 'Ignored',
    }));

    expect(result.ok).toBe(false);
    expect(storage.upsertConversation).not.toHaveBeenCalled();
  });
});
