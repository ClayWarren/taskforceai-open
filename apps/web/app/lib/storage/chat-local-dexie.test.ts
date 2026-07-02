import { beforeEach, describe, expect, it, vi } from 'bun:test';

import * as chatDb from './chat-local-dexie';

const baseConversation: any = {
  conversationId: 'c1',
  title: 'Conversation',
  createdAt: 0,
  updatedAt: 0,
  lastMessagePreview: null,
  syncVersion: 0,
  lastSyncedAt: 0,
  isDeleted: false,
};

const baseMessage: any = {
  messageId: 'm1',
  conversationId: 'c1',
  role: 'user',
  content: 'hi',
  isStreaming: false,
  createdAt: 0,
  updatedAt: 0,
  syncVersion: 0,
  lastSyncedAt: 0,
  isDeleted: false,
};

const basePrompt: any = {
  conversationId: 'c1',
  prompt: 'hello',
  createdAt: 0,
  status: 'queued',
};

// Mock dependencies
const mockRepo = {
  ensureConversation: vi.fn(),
  renameConversation: vi.fn(),
  archiveConversation: vi.fn(),
  restoreConversation: vi.fn(),
  getConversation: vi.fn(),
  upsertMessage: vi.fn(),
  getConversationMessages: vi.fn(),
  listConversations: vi.fn(),
  listArchivedConversations: vi.fn(),
  clearConversation: vi.fn(),
  archiveAllConversations: vi.fn(),
  deleteAllConversations: vi.fn(),
  enqueuePrompt: vi.fn(),
  updatePromptStatus: vi.fn(),
  removePrompt: vi.fn(),
  listPendingPrompts: vi.fn(),
};

vi.mock('@taskforceai/persistence', () => ({
  createChatRepository: () => mockRepo,
}));

vi.mock('./dexie-adapter', () => ({
  DexieStorageAdapter: class {
    readonly ready = true;
  },
}));

vi.mock('@taskforceai/web/lib/dexie-db', () => ({
  ensureDexieReady: vi.fn().mockResolvedValue(true),
}));

describe('chat-local-dexie', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset ensureDexieReady to return true by default
    const { ensureDexieReady } = require('@taskforceai/web/lib/dexie-db');
    ensureDexieReady.mockResolvedValue(true);
  });

  it('delegates ensureConversation to repository', async () => {
    await chatDb.ensureConversation('id', 'title');
    expect(mockRepo.ensureConversation).toHaveBeenCalledWith('id', 'title');
  });

  it('delegates renameConversation to repository', async () => {
    await chatDb.renameConversation('id', 'new title');
    expect(mockRepo.renameConversation).toHaveBeenCalledWith('id', 'new title');
  });

  it('delegates archiveConversation to repository', async () => {
    await chatDb.archiveConversation('id');
    expect(mockRepo.archiveConversation).toHaveBeenCalledWith('id');
  });

  it('delegates restoreConversation to repository', async () => {
    await chatDb.restoreConversation('id');
    expect(mockRepo.restoreConversation).toHaveBeenCalledWith('id');
  });

  it('delegates getConversation to repository', async () => {
    mockRepo.getConversation.mockResolvedValue({ ok: true, value: baseConversation });
    const result = await chatDb.getConversation('id');
    expect(result.ok).toBe(true);
    expect(mockRepo.getConversation).toHaveBeenCalledWith('id');
  });

  it('maps getConversation repository errors into result errors', async () => {
    const error = { kind: 'not_found' as const, message: 'Missing conversation' };
    mockRepo.getConversation.mockResolvedValue({ ok: false, error });

    const result = await chatDb.getConversation('missing-id');

    expect(result).toEqual({ ok: false, error });
  });

  it('delegates upsertMessage to repository', async () => {
    const msg = {
      conversationId: 'id',
      messageId: 'mid',
      role: 'user',
      content: 'hi',
      isStreaming: false,
    } satisfies Parameters<typeof chatDb.upsertMessage>[0];
    await chatDb.upsertMessage(msg);
    expect(mockRepo.upsertMessage).toHaveBeenCalledWith(expect.objectContaining(msg));
  });

  it('delegates getConversationMessages to repository', async () => {
    mockRepo.getConversationMessages.mockResolvedValue([baseMessage]);
    const result = await chatDb.getConversationMessages('id');
    expect(result).toEqual([baseMessage]);
    expect(mockRepo.getConversationMessages).toHaveBeenCalledWith('id');
  });

  it('delegates listConversations to repository', async () => {
    mockRepo.listConversations.mockResolvedValue([baseConversation]);
    const result = await chatDb.listConversations(10);
    expect(result.length).toBe(1);
    expect(mockRepo.listConversations).toHaveBeenCalledWith(10);
  });

  it('delegates listArchivedConversations to repository and maps archive flags', async () => {
    mockRepo.listArchivedConversations.mockResolvedValue([
      { ...baseConversation, conversationId: 'archived', isArchived: true },
      { ...baseConversation, conversationId: 'legacy', isArchived: undefined },
    ]);

    const result = await chatDb.listArchivedConversations(5);

    expect(mockRepo.listArchivedConversations).toHaveBeenCalledWith(5);
    expect(result).toEqual([
      expect.objectContaining({ conversationId: 'archived', isArchived: true }),
      expect.objectContaining({ conversationId: 'legacy', isArchived: false }),
    ]);
  });

  it('delegates clearConversation to repository', async () => {
    await chatDb.clearConversation('id');
    expect(mockRepo.clearConversation).toHaveBeenCalledWith('id');
  });

  it('delegates bulk archive and delete operations to repository', async () => {
    await chatDb.archiveAllConversations();
    await chatDb.deleteAllConversations();

    expect(mockRepo.archiveAllConversations).toHaveBeenCalledTimes(1);
    expect(mockRepo.deleteAllConversations).toHaveBeenCalledTimes(1);
  });

  it('delegates enqueuePrompt to repository', async () => {
    await chatDb.enqueuePrompt('id', 'prompt');
    expect(mockRepo.enqueuePrompt).toHaveBeenCalledWith('id', 'prompt');
  });

  it('delegates updatePromptStatus to repository', async () => {
    await chatDb.updatePromptStatus(1, 'pending');
    expect(mockRepo.updatePromptStatus).toHaveBeenCalledWith(1, 'pending');
  });

  it('delegates removePrompt to repository', async () => {
    await chatDb.removePrompt(1);
    expect(mockRepo.removePrompt).toHaveBeenCalledWith(1);
  });

  it('delegates listPendingPrompts to repository', async () => {
    mockRepo.listPendingPrompts.mockResolvedValue([basePrompt]);
    const result = await chatDb.listPendingPrompts();
    expect(result).toEqual([basePrompt]);
    expect(mockRepo.listPendingPrompts).toHaveBeenCalled();
  });

  it('getLatestConversation logic', async () => {
    mockRepo.listConversations.mockResolvedValue([baseConversation]);
    mockRepo.getConversationMessages.mockResolvedValue([baseMessage]);

    const result = await chatDb.getLatestConversation();

    expect(mockRepo.listConversations).toHaveBeenCalledWith(1);
    expect(mockRepo.getConversationMessages).toHaveBeenCalledWith('c1');
    expect(result.ok).toBe(true);
  });

  it('handles dexie not ready', async () => {
    const { ensureDexieReady } = require('@taskforceai/web/lib/dexie-db');
    ensureDexieReady.mockResolvedValue(false);

    await chatDb.ensureConversation('id', 'title');
    expect(mockRepo.ensureConversation).not.toHaveBeenCalled();

    const res = await chatDb.getConversation('id');
    expect(res).toEqual({
      ok: false,
      error: { kind: 'storage', message: 'Dexie not ready' },
    });
  });

  it('handles dexie not ready for renameConversation', async () => {
    const { ensureDexieReady } = require('@taskforceai/web/lib/dexie-db');
    ensureDexieReady.mockResolvedValue(false);

    await chatDb.renameConversation('id', 'title');
    expect(mockRepo.renameConversation).not.toHaveBeenCalled();
  });

  it('handles dexie not ready for archiveConversation', async () => {
    const { ensureDexieReady } = require('@taskforceai/web/lib/dexie-db');
    ensureDexieReady.mockResolvedValue(false);

    await chatDb.archiveConversation('id');
    expect(mockRepo.archiveConversation).not.toHaveBeenCalled();
  });

  it('handles dexie not ready for restoreConversation', async () => {
    const { ensureDexieReady } = require('@taskforceai/web/lib/dexie-db');
    ensureDexieReady.mockResolvedValue(false);

    await chatDb.restoreConversation('id');
    expect(mockRepo.restoreConversation).not.toHaveBeenCalled();
  });

  it('handles dexie not ready for getConversationMessages', async () => {
    const { ensureDexieReady } = require('@taskforceai/web/lib/dexie-db');
    ensureDexieReady.mockResolvedValue(false);

    const result = await chatDb.getConversationMessages('id');
    expect(result).toEqual([]);
  });

  it('handles dexie not ready for listConversations', async () => {
    const { ensureDexieReady } = require('@taskforceai/web/lib/dexie-db');
    ensureDexieReady.mockResolvedValue(false);

    const result = await chatDb.listConversations();
    expect(result).toEqual([]);
  });

  it('handles dexie not ready for archived conversation listing', async () => {
    const { ensureDexieReady } = require('@taskforceai/web/lib/dexie-db');
    ensureDexieReady.mockResolvedValue(false);

    const result = await chatDb.listArchivedConversations();
    expect(result).toEqual([]);
    expect(mockRepo.listArchivedConversations).not.toHaveBeenCalled();
  });

  it('handles dexie not ready for clearConversation', async () => {
    const { ensureDexieReady } = require('@taskforceai/web/lib/dexie-db');
    ensureDexieReady.mockResolvedValue(false);

    await chatDb.clearConversation('id');
    expect(mockRepo.clearConversation).not.toHaveBeenCalled();
  });

  it('handles dexie not ready for bulk archive and delete operations', async () => {
    const { ensureDexieReady } = require('@taskforceai/web/lib/dexie-db');
    ensureDexieReady.mockResolvedValue(false);

    await chatDb.archiveAllConversations();
    await chatDb.deleteAllConversations();

    expect(mockRepo.archiveAllConversations).not.toHaveBeenCalled();
    expect(mockRepo.deleteAllConversations).not.toHaveBeenCalled();
  });

  it('handles dexie not ready for upsertMessage', async () => {
    const { ensureDexieReady } = require('@taskforceai/web/lib/dexie-db');
    ensureDexieReady.mockResolvedValue(false);

    await chatDb.upsertMessage({
      conversationId: 'id',
      messageId: 'mid',
      role: 'user',
      content: 'hi',
      isStreaming: false,
    } satisfies Parameters<typeof chatDb.upsertMessage>[0]);
    expect(mockRepo.upsertMessage).not.toHaveBeenCalled();
  });

  it('handles dexie not ready for enqueuePrompt', async () => {
    const { ensureDexieReady } = require('@taskforceai/web/lib/dexie-db');
    ensureDexieReady.mockResolvedValue(false);

    await chatDb.enqueuePrompt('id', 'prompt');
    expect(mockRepo.enqueuePrompt).not.toHaveBeenCalled();
  });

  it('handles dexie not ready for updatePromptStatus', async () => {
    const { ensureDexieReady } = require('@taskforceai/web/lib/dexie-db');
    ensureDexieReady.mockResolvedValue(false);

    await chatDb.updatePromptStatus(1, 'pending');
    expect(mockRepo.updatePromptStatus).not.toHaveBeenCalled();
  });

  it('handles dexie not ready for removePrompt', async () => {
    const { ensureDexieReady } = require('@taskforceai/web/lib/dexie-db');
    ensureDexieReady.mockResolvedValue(false);

    await chatDb.removePrompt(1);
    expect(mockRepo.removePrompt).not.toHaveBeenCalled();
  });

  it('handles dexie not ready for listPendingPrompts', async () => {
    const { ensureDexieReady } = require('@taskforceai/web/lib/dexie-db');
    ensureDexieReady.mockResolvedValue(false);

    const result = await chatDb.listPendingPrompts();
    expect(result).toEqual([]);
  });

  it('handles dexie not ready for getLatestConversation', async () => {
    const { ensureDexieReady } = require('@taskforceai/web/lib/dexie-db');
    ensureDexieReady.mockResolvedValue(false);

    const result = await chatDb.getLatestConversation();
    expect(result).toEqual({
      ok: false,
      error: { kind: 'storage', message: 'Dexie not ready' },
    });
  });

  it('getLatestConversation returns not_found when no conversations', async () => {
    mockRepo.listConversations.mockResolvedValue([]);

    const result = await chatDb.getLatestConversation();
    expect(result).toEqual({
      ok: false,
      error: { kind: 'not_found', message: 'No conversations found' },
    });
  });

  it('upsertMessage passes optional params', async () => {
    const msg = {
      conversationId: 'id',
      messageId: 'mid',
      role: 'assistant',
      content: 'response',
      isStreaming: false,
      isAgentStatus: true,
      elapsedSeconds: 5,
      error: 'some error',
      sources: [{ title: 'Source', url: 'http://example.com' }],
      toolEvents: [
        {
          timestamp: new Date(0).toISOString(),
          agentLabel: 'Agent',
          toolName: 'test',
          arguments: {},
          success: true,
          durationMs: 1,
        },
      ],
      agentStatuses: [{ status: 'thinking', agent_id: 1, progress: 0 }],
      trace_id: 'trace-1',
    } satisfies Parameters<typeof chatDb.upsertMessage>[0];
    await chatDb.upsertMessage(msg);
    expect(mockRepo.upsertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        isAgentStatus: true,
        elapsedSeconds: 5,
        error: 'some error',
        sources: msg.sources,
        toolEvents: msg.toolEvents,
        agentStatuses: msg.agentStatuses,
        trace_id: 'trace-1',
      })
    );
  });

  it('listConversations uses default limit', async () => {
    mockRepo.listConversations.mockResolvedValue([]);
    await chatDb.listConversations();
    expect(mockRepo.listConversations).toHaveBeenCalledWith(20);
  });
});
