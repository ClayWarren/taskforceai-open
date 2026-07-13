import { beforeEach, describe, expect, it, mock } from 'bun:test';

const dbManagerState = {
  ensureOrmCalls: 0,
  ensureError: null as Error | null,
};

const storeState = {
  calls: [] as Array<{ method: string; args: unknown[] }>,
  messages: [] as unknown[],
  conversations: [] as unknown[],
  archivedConversations: [] as unknown[],
  throwMethod: null as string | null,
};

const sqliteState = {
  clearChatDataCalls: 0,
  deletedMessages: [] as string[],
  throwMethod: null as 'clearChatData' | 'deleteMessage' | null,
};

const ingestPlanState = {
  calls: [] as Array<{ summary: unknown; existingMessages: unknown[] }>,
};

const maybeThrow = (method: string) => {
  if (storeState.throwMethod === method) {
    throw new Error(`${method} failed`);
  }
};

const storeMock = {
  ensureConversation: async (...args: unknown[]) => {
    maybeThrow('ensureConversation');
    storeState.calls.push({ method: 'ensureConversation', args });
  },
  upsertMessage: async (...args: unknown[]) => {
    maybeThrow('upsertMessage');
    storeState.calls.push({ method: 'upsertMessage', args });
  },
  getConversationMessages: async (...args: unknown[]) => {
    maybeThrow('getConversationMessages');
    storeState.calls.push({ method: 'getConversationMessages', args });
    return storeState.messages;
  },
  listConversations: async (...args: unknown[]) => {
    maybeThrow('listConversations');
    storeState.calls.push({ method: 'listConversations', args });
    return storeState.conversations;
  },
  listArchivedConversations: async (...args: unknown[]) => {
    maybeThrow('listArchivedConversations');
    storeState.calls.push({ method: 'listArchivedConversations', args });
    return storeState.archivedConversations;
  },
  archiveConversation: async (...args: unknown[]) => {
    maybeThrow('archiveConversation');
    storeState.calls.push({ method: 'archiveConversation', args });
  },
  restoreConversation: async (...args: unknown[]) => {
    maybeThrow('restoreConversation');
    storeState.calls.push({ method: 'restoreConversation', args });
  },
  archiveAllConversations: async (...args: unknown[]) => {
    maybeThrow('archiveAllConversations');
    storeState.calls.push({ method: 'archiveAllConversations', args });
  },
  clearConversation: async (...args: unknown[]) => {
    maybeThrow('clearConversation');
    storeState.calls.push({ method: 'clearConversation', args });
  },
};

const resetState = () => {
  dbManagerState.ensureOrmCalls = 0;
  dbManagerState.ensureError = null;
  storeState.calls = [];
  storeState.messages = [];
  storeState.conversations = [];
  storeState.archivedConversations = [];
  storeState.throwMethod = null;
  sqliteState.clearChatDataCalls = 0;
  sqliteState.deletedMessages = [];
  sqliteState.throwMethod = null;
  ingestPlanState.calls = [];
};

mock.module('../../storage/database-manager', () => ({
  dbManager: {
    ensureOrm: async () => {
      dbManagerState.ensureOrmCalls += 1;
      if (dbManagerState.ensureError) throw dbManagerState.ensureError;
    },
  },
}));

mock.module('../../storage/sqlite-adapter', () => ({
  sqliteStorage: {
    clearChatData: async () => {
      if (sqliteState.throwMethod === 'clearChatData') {
        throw new Error('clearChatData failed');
      }
      sqliteState.clearChatDataCalls += 1;
    },
    deleteMessage: async (messageId: string) => {
      if (sqliteState.throwMethod === 'deleteMessage') {
        throw new Error('deleteMessage failed');
      }
      sqliteState.deletedMessages.push(messageId);
    },
  },
}));

mock.module('@taskforceai/client-runtime', () => ({
  createPersistentConversationStore: () => storeMock,
}));

mock.module('../../storage/remote-conversation-ingest', () => ({
  createRemoteConversationIngestPlan: (summary: unknown, existingMessages: unknown[]) => {
    ingestPlanState.calls.push({ summary, existingMessages });
    return {
      userMessage: { messageId: 'user-message' },
      agentStatusMessage: { messageId: 'agent-status-message' },
      assistantMessage: { messageId: 'assistant-message' },
    };
  },
}));

mock.module('../../logger', () => ({
  mobileLogger: {
    error: () => {},
  },
  createModuleLogger: () => ({
    error: () => {},
  }),
}));

const chatLocal = await import('../../storage/chat-local-mobile.internal');

describe('chat-local-mobile internal storage adapter', () => {
  beforeEach(() => {
    resetState();
  });

  it('ensures the ORM before mutating conversations and messages', async () => {
    await chatLocal.ensureConversation('conv-1', 'Title');
    await chatLocal.upsertMessage({ messageId: 'msg-1' } as any);
    await chatLocal.archiveConversation('conv-1');
    await chatLocal.restoreConversation('conv-1');
    await chatLocal.archiveAllConversations();
    await chatLocal.clearConversation('conv-1');
    await chatLocal.deleteAllConversations();
    await chatLocal.deleteMessage('msg-1', 'conv-1');

    expect(dbManagerState.ensureOrmCalls).toBe(8);
    expect(storeState.calls).toEqual([
      { method: 'ensureConversation', args: ['conv-1', 'Title'] },
      { method: 'upsertMessage', args: [{ messageId: 'msg-1' }] },
      { method: 'archiveConversation', args: ['conv-1'] },
      { method: 'restoreConversation', args: ['conv-1'] },
      { method: 'archiveAllConversations', args: [] },
      { method: 'clearConversation', args: ['conv-1'] },
    ]);
    expect(sqliteState.clearChatDataCalls).toBe(1);
    expect(sqliteState.deletedMessages).toEqual(['msg-1']);
  });

  it('returns result-wrapped conversation reads', async () => {
    storeState.messages = [{ messageId: 'msg-1' }];
    storeState.conversations = [{ conversationId: 'conv-1' }];
    storeState.archivedConversations = [{ conversationId: 'archived-1' }];

    const messages = await chatLocal.getConversationMessages('conv-1', 10, 2);
    const conversations = await chatLocal.listConversations(7);
    const archived = await chatLocal.listArchivedConversations(3);

    expect(messages.ok).toBe(true);
    expect(conversations.ok).toBe(true);
    expect(archived.ok).toBe(true);
    if (messages.ok) expect(messages.value).toEqual([{ messageId: 'msg-1' }]);
    if (conversations.ok) expect(conversations.value).toEqual([{ conversationId: 'conv-1' }]);
    if (archived.ok) expect(archived.value).toEqual([{ conversationId: 'archived-1' }]);
    expect(storeState.calls).toEqual([
      { method: 'getConversationMessages', args: ['conv-1', 10, 2] },
      { method: 'listConversations', args: [7] },
      { method: 'listArchivedConversations', args: [3] },
    ]);
  });

  it('returns errors for read failures and rethrows mutation failures', async () => {
    storeState.throwMethod = 'listConversations';

    const conversations = await chatLocal.listConversations();

    expect(conversations.ok).toBe(false);
    if (!conversations.ok) {
      expect(conversations.error.message).toBe('listConversations failed');
    }

    storeState.throwMethod = 'ensureConversation';
    await expect(chatLocal.ensureConversation('conv-1', 'Title')).rejects.toThrow(
      'ensureConversation failed'
    );
  });

  it('returns errors for message and archived conversation read failures', async () => {
    storeState.throwMethod = 'getConversationMessages';

    const messages = await chatLocal.getConversationMessages('conv-1');

    expect(messages.ok).toBe(false);
    if (!messages.ok) {
      expect(messages.error.message).toBe('getConversationMessages failed');
    }

    storeState.throwMethod = 'listArchivedConversations';
    const archived = await chatLocal.listArchivedConversations();

    expect(archived.ok).toBe(false);
    if (!archived.ok) {
      expect(archived.error.message).toBe('listArchivedConversations failed');
    }
  });

  it('rethrows write and archive operation failures', async () => {
    const failingCalls = [
      ['upsertMessage', () => chatLocal.upsertMessage({ messageId: 'msg-1' } as any)],
      ['archiveConversation', () => chatLocal.archiveConversation('conv-1')],
      ['restoreConversation', () => chatLocal.restoreConversation('conv-1')],
      ['archiveAllConversations', () => chatLocal.archiveAllConversations()],
      ['clearConversation', () => chatLocal.clearConversation('conv-1')],
    ] as const;

    for (const [method, call] of failingCalls) {
      storeState.throwMethod = method;
      await expect(call()).rejects.toThrow(`${method} failed`);
    }
  });

  it('rethrows local SQLite clear and delete failures', async () => {
    sqliteState.throwMethod = 'clearChatData';
    await expect(chatLocal.deleteAllConversations()).rejects.toThrow('clearChatData failed');

    sqliteState.throwMethod = 'deleteMessage';
    await expect(chatLocal.deleteMessage('msg-1', 'conv-1')).rejects.toThrow(
      'deleteMessage failed'
    );
  });

  it('ingests remote summaries through the remote ingest plan', async () => {
    const existingMessage = { messageId: 'existing-message' };
    storeState.messages = [existingMessage];
    const summary = {
      id: 'remote-1',
      user_input: 'Plan launch',
      status: 'completed',
    } as any;

    await chatLocal.ingestRemoteConversationSummary(summary);

    expect(ingestPlanState.calls).toEqual([
      { summary, existingMessages: [existingMessage] },
    ]);
    expect(storeState.calls).toEqual([
      { method: 'ensureConversation', args: ['remote-remote-1', 'Plan launch'] },
      { method: 'getConversationMessages', args: ['remote-remote-1', undefined, undefined] },
      { method: 'upsertMessage', args: [{ messageId: 'user-message' }] },
      { method: 'upsertMessage', args: [{ messageId: 'agent-status-message' }] },
      { method: 'upsertMessage', args: [{ messageId: 'assistant-message' }] },
    ]);
  });

  it('ingests remote summaries without existing messages when lookup fails', async () => {
    storeState.throwMethod = 'getConversationMessages';
    const summary = {
      id: 'remote-2',
      status: 'completed',
    } as any;

    await chatLocal.ingestRemoteConversationSummary(summary);

    expect(ingestPlanState.calls).toEqual([{ summary, existingMessages: [] }]);
    expect(storeState.calls).toEqual([
      { method: 'ensureConversation', args: ['remote-remote-2', 'Remote Conversation'] },
      { method: 'upsertMessage', args: [{ messageId: 'user-message' }] },
      { method: 'upsertMessage', args: [{ messageId: 'agent-status-message' }] },
      { method: 'upsertMessage', args: [{ messageId: 'assistant-message' }] },
    ]);
  });
});
