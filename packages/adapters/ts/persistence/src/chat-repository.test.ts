import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { runRequestSchema } from '@taskforceai/contracts/contracts';

import {
  conversationResultError,
  createStorageMock,
  messageResultError,
  storageConversation,
  storageMessage,
  type StorageAdapterMock,
} from '#tests/fixtures/sync-storage';
import { ok } from '@taskforceai/client-core/result';
import { ChatRepository, createChatRepository } from './chat-repository';
import { createNoopSearchIndex } from './search-index';
import type { SearchIndex } from './search-index';

describe('persistence/chat-repository', () => {
  let storage: StorageAdapterMock;
  let repository: ChatRepository;
  let searchIndex: SearchIndex;

  beforeEach(() => {
    storage = createStorageMock();
    searchIndex = {
      addItem: vi.fn(),
      removeItem: vi.fn(),
    };
    repository = new ChatRepository(storage, searchIndex);
  });

  it('delegates conversation operations', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1710003000000);

    storage.getConversation
      .mockResolvedValueOnce(conversationResultError('NOT_FOUND'))
      .mockResolvedValueOnce(
        ok({
          conversationId: 'conv-1',
          title: 'Original',
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
          title: 'Renamed',
          createdAt: 1,
          updatedAt: 2,
          lastMessagePreview: null,
          syncVersion: 0,
          lastSyncedAt: 0,
          isDeleted: false,
        })
      );

    storage.getConversations.mockResolvedValueOnce([
      {
        conversationId: 'conv-1',
        title: 'Renamed',
        createdAt: 1,
        updatedAt: 2,
        lastMessagePreview: null,
        syncVersion: 0,
        lastSyncedAt: 0,
        isDeleted: false,
      },
    ]);
    storage.getMessages.mockResolvedValueOnce([
      {
        messageId: 'msg-remove-1',
        conversationId: 'conv-1',
        role: 'assistant',
        content: 'to remove',
        isStreaming: false,
        createdAt: 1,
        updatedAt: 2,
        syncVersion: 0,
        lastSyncedAt: 0,
        isDeleted: false,
      },
    ]);

    await repository.ensureConversation('conv-1', 'New Title');
    await repository.renameConversation('conv-1', 'Renamed');

    const conversation = await repository.getConversation('conv-1');
    expect(conversation.ok).toBe(true);

    const conversations = await repository.listConversations(5);
    expect(conversations).toHaveLength(1);

    await repository.clearConversation('conv-1');

    expect(storage.upsertConversation).toHaveBeenCalledTimes(2);
    expect(storage.getConversations).toHaveBeenCalledWith(5, 0);
    expect(storage.deleteConversation).toHaveBeenCalledWith('conv-1');
    expect(searchIndex.removeItem).toHaveBeenCalledWith('msg-remove-1');
  });

  it('delegates pending prompt operations', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1710003000500);
    const runPayload = runRequestSchema.parse({
      prompt: 'queued prompt',
      demo: false,
      modelId: 'openai/gpt-5.6-sol',
    });

    const pendingChange = {
      id: 5,
      type: 'prompt' as const,
      entityId: 'conv-1',
      operation: 'create' as const,
      data: { prompt: 'queued prompt', status: 'queued', runPayload },
      createdAt: 10,
    };
    storage.getPendingChanges
      .mockResolvedValueOnce([pendingChange])
      .mockResolvedValueOnce([pendingChange]);

    await repository.enqueuePrompt('conv-1', 'queued prompt', runPayload);
    await repository.updatePromptStatus(5, 'failed');
    await repository.removePrompt(5);

    const pending = await repository.listPendingPrompts();

    expect(storage.addPendingChange).toHaveBeenCalledWith({
      type: 'prompt',
      entityId: 'conv-1',
      operation: 'create',
      data: { prompt: 'queued prompt', status: 'queued', runPayload },
      createdAt: 1710003000500,
    });
    expect(storage.updatePendingChangeData).toHaveBeenCalledWith(5, {
      prompt: 'queued prompt',
      status: 'failed',
      runPayload,
    });
    expect(storage.removePendingChange).toHaveBeenCalledWith(5);
    expect(pending).toEqual([
      {
        id: 5,
        conversationId: 'conv-1',
        prompt: 'queued prompt',
        createdAt: 10,
        status: 'queued',
        runPayload,
      },
    ]);
  });

  it('delegates conversation id replacement', async () => {
    await repository.replaceConversationId('local-conv', 'server-conv');

    expect(storage.replaceConversationId).toHaveBeenCalledWith('local-conv', 'server-conv');
  });

  it('updates a conversation project through the conversation store', async () => {
    storage.getConversation.mockResolvedValueOnce(
      ok(
        storageConversation({
          conversationId: 'conv-project',
          title: 'Project chat',
        })
      )
    );

    await repository.setConversationProjectId('conv-project', 17);

    expect(storage.upsertConversation).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-project', projectId: 17 })
    );
  });

  it('archives conversations through the conversation store', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1710003000750);
    storage.getConversation.mockResolvedValueOnce(
      ok(
        storageConversation({
          conversationId: 'conv-archive',
          title: 'Keep for Later',
          createdAt: 1710003000000,
          updatedAt: 1710003000100,
        })
      )
    );

    await repository.archiveConversation('conv-archive');

    expect(storage.upsertConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-archive',
        isArchived: true,
        updatedAt: 1710003000750,
      })
    );
  });

  it('restores and lists archived conversations through the conversation store', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1710003000800);
    storage.getConversation.mockResolvedValueOnce(
      ok(
        storageConversation({
          conversationId: 'conv-archive',
          title: 'Keep for Later',
          isArchived: true,
        })
      )
    );
    storage.getArchivedConversations.mockResolvedValueOnce([
      storageConversation({
        conversationId: 'conv-archive',
        title: 'Keep for Later',
        isArchived: true,
      }),
    ]);

    await repository.restoreConversation('conv-archive');
    const archived = await repository.listArchivedConversations(10, 0);

    expect(storage.upsertConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-archive',
        isArchived: false,
        updatedAt: 1710003000800,
      })
    );
    expect(storage.getArchivedConversations).toHaveBeenCalledWith(10, 0);
    expect(archived).toEqual([
      expect.objectContaining({
        conversationId: 'conv-archive',
        isArchived: true,
      }),
    ]);
  });

  it('archives and deletes all conversations through the conversation store', async () => {
    storage.getConversations.mockResolvedValueOnce([
      storageConversation({ conversationId: 'active-1' }),
    ]);
    storage.getArchivedConversations.mockResolvedValueOnce([
      storageConversation({ conversationId: 'archived-1', isArchived: true }),
    ]);
    storage.getMessages
      .mockResolvedValueOnce([
        storageMessage({ messageId: 'msg-active', conversationId: 'active-1' }),
      ])
      .mockResolvedValueOnce([
        storageMessage({ messageId: 'msg-archived', conversationId: 'archived-1' }),
      ]);

    await repository.archiveAllConversations();
    await repository.deleteAllConversations();

    expect(storage.archiveAllConversations).toHaveBeenCalled();
    expect(storage.deleteAllConversations).toHaveBeenCalled();
    expect(searchIndex.removeItem).toHaveBeenCalledWith('msg-active');
    expect(searchIndex.removeItem).toHaveBeenCalledWith('msg-archived');
  });

  it('removes every cleared conversation message from the search index', async () => {
    const messages = [
      storageMessage({
        messageId: 'msg-remove-1',
        conversationId: 'conv-clear',
        role: 'user',
        content: 'question',
      }),
      storageMessage({
        messageId: 'msg-remove-2',
        conversationId: 'conv-clear',
        role: 'assistant',
        content: 'answer',
      }),
    ];
    storage.getMessages.mockImplementationOnce(async () => {
      expect(storage.deleteConversation).not.toHaveBeenCalled();
      return messages;
    });

    await repository.clearConversation('conv-clear');

    expect(storage.getMessages).toHaveBeenCalledWith('conv-clear', undefined, undefined);
    expect(storage.deleteConversation).toHaveBeenCalledWith('conv-clear');
    expect(searchIndex.removeItem).toHaveBeenCalledTimes(2);
    expect(searchIndex.removeItem).toHaveBeenNthCalledWith(1, 'msg-remove-1');
    expect(searchIndex.removeItem).toHaveBeenNthCalledWith(2, 'msg-remove-2');
  });

  it('skips message enumeration for default no-op search index cleanup', async () => {
    const defaultRepository = createChatRepository(storage);

    await defaultRepository.clearConversation('conv-clear');
    await defaultRepository.deleteAllConversations();

    expect(storage.getMessages).not.toHaveBeenCalled();
    expect(storage.getConversations).not.toHaveBeenCalled();
    expect(storage.getArchivedConversations).not.toHaveBeenCalled();
    expect(storage.deleteConversation).toHaveBeenCalledWith('conv-clear');
    expect(storage.deleteAllConversations).toHaveBeenCalled();
  });

  it('delegates message operations', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1710003001000);

    storage.getMessage.mockResolvedValueOnce(messageResultError('NOT_FOUND'));
    storage.getConversation.mockResolvedValue(
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
    storage.getMessages.mockResolvedValueOnce([
      {
        messageId: 'msg-1',
        conversationId: 'conv-1',
        role: 'assistant',
        content: 'response',
        isStreaming: false,
        createdAt: 1,
        updatedAt: 2,
        syncVersion: 0,
        lastSyncedAt: 0,
        isDeleted: false,
      },
    ]);

    await repository.upsertMessage({
      conversationId: 'conv-1',
      messageId: 'msg-1',
      role: 'assistant',
      content: 'response',
      isStreaming: false,
    });

    const messages = await repository.getConversationMessages('conv-1');

    expect(storage.upsertMessage).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'msg-1', content: 'response' })
    );
    expect(storage.upsertConversation).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', lastMessagePreview: 'response' })
    );
    expect(searchIndex.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'msg-1',
        title: 'assistant message',
        content: 'response',
        tags: ['conv-1', 'assistant'],
      })
    );
    expect(messages).toEqual([
      {
        messageId: 'msg-1',
        conversationId: 'conv-1',
        role: 'assistant',
        content: 'response',
        isStreaming: false,
        createdAt: 1,
        updatedAt: 2,
        syncVersion: 0,
        lastSyncedAt: 0,
        isDeleted: false,
      },
    ]);
  });

  it('supports trace_id alias when upserting messages', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1710003001100);

    storage.getMessage.mockResolvedValueOnce(messageResultError('NOT_FOUND'));
    storage.getConversation.mockResolvedValue(
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

    await repository.upsertMessage({
      conversationId: 'conv-1',
      messageId: 'msg-trace-alias',
      role: 'assistant',
      content: 'response with trace',
      isStreaming: false,
      trace_id: 'trace-alias-1',
    });

    expect(storage.upsertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'msg-trace-alias',
        traceId: 'trace-alias-1',
      })
    );
  });

  it('creates repository via factory function', async () => {
    const repo = createChatRepository(storage);
    expect(repo).toBeInstanceOf(ChatRepository);

    storage.getConversation.mockResolvedValueOnce(conversationResultError('NOT_FOUND'));

    await repo.ensureConversation('conv-test', 'Test');
    expect(storage.upsertConversation).toHaveBeenCalled();
  });

  it('passes the optional search index through the factory function', async () => {
    const repo = createChatRepository(storage, searchIndex);
    storage.getMessages.mockResolvedValueOnce([
      storageMessage({ messageId: 'msg-factory-remove', conversationId: 'conv-clear' }),
    ]);

    await repo.clearConversation('conv-clear');

    expect(storage.getMessages).toHaveBeenCalledWith('conv-clear', undefined, undefined);
    expect(searchIndex.removeItem).toHaveBeenCalledWith('msg-factory-remove');
  });
});

describe('persistence/search-index', () => {
  it('createNoopSearchIndex returns no-op implementation', () => {
    const index = createNoopSearchIndex();
    expect(() => index.addItem({ id: '1', title: 'Test', content: 'Content' })).not.toThrow();
    expect(() => index.removeItem('1')).not.toThrow();
  });
});
