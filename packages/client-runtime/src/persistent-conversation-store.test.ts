import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import * as persistence from '@taskforceai/persistence';

import { ok } from '@taskforceai/shared/result';

import type { ConversationRecord, MessageRecord } from './types';
import {
  createPersistentConversationStore,
  PersistentConversationStore,
} from './persistent-conversation-store';

describe('PersistentConversationStore', () => {
  let repository: {
    ensureConversation: ReturnType<typeof vi.fn>;
    renameConversation: ReturnType<typeof vi.fn>;
    archiveConversation: ReturnType<typeof vi.fn>;
    restoreConversation: ReturnType<typeof vi.fn>;
    getConversation: ReturnType<typeof vi.fn>;
    getConversationMessages: ReturnType<typeof vi.fn>;
    upsertMessage: ReturnType<typeof vi.fn>;
    listConversations: ReturnType<typeof vi.fn>;
    listArchivedConversations: ReturnType<typeof vi.fn>;
    clearConversation: ReturnType<typeof vi.fn>;
    archiveAllConversations: ReturnType<typeof vi.fn>;
    deleteAllConversations: ReturnType<typeof vi.fn>;
    replaceConversationId: ReturnType<typeof vi.fn>;
    enqueuePrompt: ReturnType<typeof vi.fn>;
    updatePromptStatus: ReturnType<typeof vi.fn>;
    removePrompt: ReturnType<typeof vi.fn>;
    listPendingPrompts: ReturnType<typeof vi.fn>;
  };

  const logger = {
    warn: vi.fn(),
    error: vi.fn(),
  };

  const createRepository = () => ({
    ensureConversation: vi.fn(async () => {}),
    renameConversation: vi.fn(async () => {}),
    archiveConversation: vi.fn(async () => {}),
    restoreConversation: vi.fn(async () => {}),
    getConversation: vi.fn(async () =>
      ok({
        conversationId: 'c1',
        title: 'Conversation',
        createdAt: 1,
        updatedAt: 1,
        lastMessagePreview: null,
      })
    ),
    getConversationMessages: vi.fn(async (): Promise<MessageRecord[]> => []),
    upsertMessage: vi.fn(async () => {}),
    listConversations: vi.fn(async (): Promise<ConversationRecord[]> => []),
    listArchivedConversations: vi.fn(async (): Promise<ConversationRecord[]> => []),
    clearConversation: vi.fn(async () => {}),
    archiveAllConversations: vi.fn(async () => {}),
    deleteAllConversations: vi.fn(async () => {}),
    replaceConversationId: vi.fn(async () => {}),
    enqueuePrompt: vi.fn(async () => {}),
    updatePromptStatus: vi.fn(async () => {}),
    removePrompt: vi.fn(async () => {}),
    listPendingPrompts: vi.fn(async () => []),
  });

  beforeEach(() => {
    repository = createRepository();
    logger.warn.mockReset();
    logger.error.mockReset();
    vi.spyOn(persistence, 'createChatRepository').mockReturnValue(repository as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('delegates repository methods and emits conversation events', async () => {
    const store = new PersistentConversationStore({
      adapter: {} as never,
      logger,
    });
    const events: Array<{ type: string; conversationId?: string }> = [];
    const unsubscribe = store.subscribe((event) => events.push(event));

    await store.ensureConversation('c1', 'Initial');
    await store.archiveConversation('c1');
    await store.restoreConversation('c1');
    await store.archiveAllConversations();
    await store.deleteAllConversations();
    unsubscribe();
    await store.renameConversation('c1', 'Renamed');

    expect(repository.ensureConversation).toHaveBeenCalledWith('c1', 'Initial');
    expect(repository.archiveConversation).toHaveBeenCalledWith('c1');
    expect(repository.restoreConversation).toHaveBeenCalledWith('c1');
    expect(repository.archiveAllConversations).toHaveBeenCalled();
    expect(repository.deleteAllConversations).toHaveBeenCalled();
    expect(repository.renameConversation).toHaveBeenCalledWith('c1', 'Renamed');
    expect(events).toEqual([
      { type: 'conversations-changed', conversationId: 'c1' },
      { type: 'conversations-changed', conversationId: 'c1' },
      { type: 'conversations-changed', conversationId: 'c1' },
      { type: 'conversations-changed' },
      { type: 'conversations-changed' },
    ]);
  });

  it('logs and removes subscribers after repeated failures', async () => {
    const store = new PersistentConversationStore({
      adapter: {} as never,
      logger,
    });
    const failingSubscriber = vi.fn(() => {
      throw new Error('listener exploded');
    });
    const healthySubscriber = vi.fn(() => {});
    store.subscribe(failingSubscriber);
    store.subscribe(healthySubscriber);

    await store.ensureConversation('c1', '1');
    await store.ensureConversation('c1', '2');
    await store.ensureConversation('c1', '3');
    await store.ensureConversation('c1', '4');

    expect(failingSubscriber).toHaveBeenCalledTimes(3);
    expect(healthySubscriber).toHaveBeenCalledTimes(4);
    expect(logger.error).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      '[PersistentConversationStore] Removed subscriber after consecutive failures',
      expect.objectContaining({
        eventType: 'conversations-changed',
        failureCount: 3,
        maxFailures: 3,
      })
    );
  });

  it('emits message and pending-prompt events around repository updates', async () => {
    repository.listPendingPrompts.mockResolvedValue([
      {
        id: 7,
        conversationId: 'c9',
        prompt: 'retry me',
        createdAt: 10,
        status: 'queued',
        runPayload: { prompt: 'retry me', demo: false, modelId: 'openai/gpt-5.5' },
      },
    ]);
    const store = new PersistentConversationStore({
      adapter: {} as never,
      logger,
    });
    const events: Array<{ type: string; conversationId?: string }> = [];
    store.subscribe((event) => events.push(event));

    await store.upsertMessage({
      conversationId: 'c9',
      messageId: 'm1',
      role: 'assistant',
      content: 'hello',
      isStreaming: false,
    });
    await store.enqueuePrompt('c9', 'retry me', {
      prompt: 'retry me',
      demo: false,
      modelId: 'openai/gpt-5.5',
    });
    await store.updatePromptStatus(7, 'pending');
    await store.removePrompt(7);

    expect(await store.listPendingPrompts()).toEqual([
      {
        id: 7,
        conversationId: 'c9',
        prompt: 'retry me',
        createdAt: 10,
        status: 'queued',
        runPayload: { prompt: 'retry me', demo: false, modelId: 'openai/gpt-5.5' },
      },
    ]);
    expect(events).toEqual([
      { type: 'messages-changed', conversationId: 'c9' },
      { type: 'conversations-changed', conversationId: 'c9' },
      { type: 'pending-prompts-changed', conversationId: 'c9' },
      { type: 'pending-prompts-changed' },
      { type: 'pending-prompts-changed' },
    ]);
  });

  it('replaces conversation ids and emits refresh events for both ids', async () => {
    const store = new PersistentConversationStore({
      adapter: {} as never,
      logger,
    });
    const events: Array<{ type: string; conversationId?: string }> = [];
    store.subscribe((event) => events.push(event));

    await store.replaceConversationId('local-1', 'remote-9');

    expect(repository.replaceConversationId).toHaveBeenCalledWith('local-1', 'remote-9');
    expect(events).toEqual([
      { type: 'conversations-changed', conversationId: 'local-1' },
      { type: 'conversations-changed', conversationId: 'remote-9' },
      { type: 'messages-changed', conversationId: 'remote-9' },
    ]);
  });

  it('clears conversations and emits conversation and message refresh events', async () => {
    const store = new PersistentConversationStore({
      adapter: {} as never,
      logger,
    });
    const events: Array<{ type: string; conversationId?: string }> = [];
    store.subscribe((event) => events.push(event));

    await store.clearConversation('c1');

    expect(repository.clearConversation).toHaveBeenCalledWith('c1');
    expect(events).toEqual([
      { type: 'conversations-changed', conversationId: 'c1' },
      { type: 'messages-changed', conversationId: 'c1' },
    ]);
  });

  it('skips no-op conversation id replacements', async () => {
    const store = new PersistentConversationStore({
      adapter: {} as never,
      logger,
    });
    const events: Array<{ type: string; conversationId?: string }> = [];
    store.subscribe((event) => events.push(event));

    await store.replaceConversationId('local-1', 'local-1');

    expect(repository.replaceConversationId).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('ignores invalid prompt status updates', async () => {
    const store = new PersistentConversationStore({
      adapter: {} as never,
      logger,
    });
    const events: Array<{ type: string; conversationId?: string }> = [];
    store.subscribe((event) => events.push(event));

    await store.updatePromptStatus(undefined as never, 'pending');

    expect(repository.updatePromptStatus).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('passes read methods through to the repository', async () => {
    repository.getConversationMessages.mockResolvedValue([
      {
        messageId: 'm1',
        conversationId: 'c1',
        role: 'assistant',
        content: 'ready',
        isStreaming: false,
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    repository.listConversations.mockResolvedValue([
      {
        conversationId: 'c1',
        title: 'Conversation',
        createdAt: 1,
        updatedAt: 1,
        lastMessagePreview: 'ready',
      },
    ]);
    repository.listArchivedConversations.mockResolvedValue([
      {
        conversationId: 'c2',
        title: 'Archived conversation',
        createdAt: 2,
        updatedAt: 2,
        lastMessagePreview: null,
        isArchived: true,
      },
    ]);
    const store = new PersistentConversationStore({
      adapter: {} as never,
      logger,
    });

    const conversation = await store.getConversation('c1');
    const messages = await store.getConversationMessages('c1', 10, 20);
    const conversations = await store.listConversations(5, 15);
    const archived = await store.listArchivedConversations(6, 16);

    expect(repository.getConversation).toHaveBeenCalledWith('c1');
    expect(repository.getConversationMessages).toHaveBeenCalledWith('c1', 10, 20);
    expect(repository.listConversations).toHaveBeenCalledWith(5, 15);
    expect(repository.listArchivedConversations).toHaveBeenCalledWith(6, 16);
    expect(conversation.ok).toBe(true);
    expect(messages).toHaveLength(1);
    expect(conversations).toHaveLength(1);
    expect(archived).toHaveLength(1);
  });

  it('creates stores through the exported factory', async () => {
    const store = createPersistentConversationStore({
      adapter: {} as never,
      logger,
    });

    await store.ensureConversation('c1', 'Factory conversation');

    expect(repository.ensureConversation).toHaveBeenCalledWith('c1', 'Factory conversation');
  });
});
