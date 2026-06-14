import { beforeEach, describe, expect, it, vi } from 'bun:test';

import { logger } from '../logger';

const mocks = {
  ensureConversation: vi.fn(),
  renameConversation: vi.fn(),
  archiveConversation: vi.fn(),
  getConversation: vi.fn(),
  upsertMessage: vi.fn(),
  getConversationMessages: vi.fn(),
  listConversations: vi.fn(),
  clearConversation: vi.fn(),
  enqueuePrompt: vi.fn(),
  updatePromptStatus: vi.fn(),
  removePrompt: vi.fn(),
  listPendingPrompts: vi.fn(),
};

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

// Set on global
(globalThis as any).__chatRepoMocks = mocks;

vi.mock('@taskforceai/persistence', () => ({
  createChatRepository: () => (globalThis as any).__chatRepoMocks,
}));

vi.mock('./tauri-adapter', () => ({
  tauriStorage: {},
}));

vi.mock('../logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

describe('chat-local-tauri', () => {
  let chatTauri: typeof import('./chat-local-tauri');

  beforeEach(async () => {
    vi.clearAllMocks();
    Object.values(mocks).forEach((m) => m.mockClear());

    if (!chatTauri) {
      chatTauri = await import('./chat-local-tauri');
    }
  });

  it('delegates ensureConversation and handles error', async () => {
    await chatTauri.ensureConversation('id', 'title');
    expect(mocks.ensureConversation).toHaveBeenCalledWith('id', 'title');

    mocks.ensureConversation.mockRejectedValue(new Error('fail'));
    await chatTauri.ensureConversation('id', 'title');
    expect(logger.error).toHaveBeenCalled();
  });

  it('delegates renameConversation and handles error', async () => {
    await chatTauri.renameConversation('id', 'title');
    expect(mocks.renameConversation).toHaveBeenCalledWith('id', 'title');

    mocks.renameConversation.mockRejectedValue(new Error('fail'));
    await chatTauri.renameConversation('id', 'title');
    expect(logger.error).toHaveBeenCalled();
  });

  it('delegates archiveConversation and handles error', async () => {
    await chatTauri.archiveConversation('id');
    expect(mocks.archiveConversation).toHaveBeenCalledWith('id');

    mocks.archiveConversation.mockRejectedValue(new Error('fail'));
    await chatTauri.archiveConversation('id');
    expect(logger.error).toHaveBeenCalled();
  });

  it('delegates getConversation and handles error', async () => {
    mocks.getConversation.mockResolvedValue({ ok: true, value: baseConversation });
    const res = await chatTauri.getConversation('id');
    expect(res.ok).toBe(true);

    mocks.getConversation.mockRejectedValue(new Error('fail'));
    const res2 = await chatTauri.getConversation('id');
    expect(res2).toEqual({
      ok: false,
      error: { kind: 'storage', message: 'Failed to load conversation' },
    });
    expect(logger.error).toHaveBeenCalled();
  });

  it('delegates upsertMessage and handles error', async () => {
    const p = {
      conversationId: '1',
      messageId: '2',
      role: 'user' as any,
      content: 'txt',
      isStreaming: false,
    };
    await chatTauri.upsertMessage(p);
    expect(mocks.upsertMessage).toHaveBeenCalled();

    mocks.upsertMessage.mockRejectedValue(new Error('fail'));
    await chatTauri.upsertMessage(p);
    expect(logger.error).toHaveBeenCalled();
  });

  it('delegates getConversationMessages and handles error', async () => {
    mocks.getConversationMessages.mockResolvedValue([baseMessage]);
    await chatTauri.getConversationMessages('id');
    expect(mocks.getConversationMessages).toHaveBeenCalled();

    mocks.getConversationMessages.mockRejectedValue(new Error('fail'));
    const res = await chatTauri.getConversationMessages('id');
    expect(res).toEqual([]);
    expect(logger.error).toHaveBeenCalled();
  });

  it('delegates listConversations and handles error', async () => {
    mocks.listConversations.mockResolvedValue([baseConversation]);
    await chatTauri.listConversations();
    expect(mocks.listConversations).toHaveBeenCalled();

    mocks.listConversations.mockRejectedValue(new Error('fail'));
    const res = await chatTauri.listConversations();
    expect(res).toEqual([]);
    expect(logger.error).toHaveBeenCalled();
  });

  it('delegates clearConversation and handles error', async () => {
    await chatTauri.clearConversation('id');
    expect(mocks.clearConversation).toHaveBeenCalled();

    mocks.clearConversation.mockRejectedValue(new Error('fail'));
    await chatTauri.clearConversation('id');
    expect(logger.error).toHaveBeenCalled();
  });

  it('delegates prompt operations (no try-catch in impl)', async () => {
    await chatTauri.enqueuePrompt('id', 'p');
    expect(mocks.enqueuePrompt).toHaveBeenCalled();

    await chatTauri.updatePromptStatus(1, 'pending');
    expect(mocks.updatePromptStatus).toHaveBeenCalled();

    await chatTauri.removePrompt(1);
    expect(mocks.removePrompt).toHaveBeenCalled();

    await chatTauri.listPendingPrompts();
    expect(mocks.listPendingPrompts).toHaveBeenCalled();
  });

  it('getLatestConversation logic', async () => {
    mocks.listConversations.mockResolvedValue([baseConversation]);
    mocks.getConversationMessages.mockResolvedValue([baseMessage]);

    const res = await chatTauri.getLatestConversation();
    expect(res.ok).toBe(true);
  });

  it('getLatestConversation returns not_found if no conversations', async () => {
    mocks.listConversations.mockResolvedValue([]);
    const res = await chatTauri.getLatestConversation();
    expect(res).toEqual({
      ok: false,
      error: { kind: 'not_found', message: 'No conversations found' },
    });
  });
});
