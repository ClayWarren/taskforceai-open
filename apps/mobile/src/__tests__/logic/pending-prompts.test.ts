import { beforeEach, describe, expect, it, mock } from 'bun:test';

const dbManagerState = {
  ensureOrmCalls: 0,
};

const storeState = {
  enqueued: [] as Array<{ conversationId: string; prompt: string; runPayload: unknown }>,
  statusUpdates: [] as Array<{ id: number; status: string }>,
  removed: [] as number[],
  prompts: [] as Array<{
    id?: number;
    conversationId: string;
    prompt: string;
    status: 'queued' | 'running' | 'failed';
    createdAt: number;
    runPayload?: unknown;
  }>,
};

mock.module('../../storage/database-manager', () => ({
  dbManager: {
    ensureOrm: async () => {
      dbManagerState.ensureOrmCalls += 1;
    },
  },
}));

mock.module('../../storage/chat-local-mobile.internal', () => ({
  mobileConversationStore: {
    enqueuePrompt: async (conversationId: string, prompt: string, runPayload: unknown) => {
      storeState.enqueued.push({ conversationId, prompt, runPayload });
    },
    updatePromptStatus: async (id: number, status: string) => {
      storeState.statusUpdates.push({ id, status });
    },
    removePrompt: async (id: number) => {
      storeState.removed.push(id);
    },
    listPendingPrompts: async () => storeState.prompts,
  },
}));

mock.module('../../logger', () => ({
  mobileLogger: {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    child: () => ({
      debug: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
      error: mock(() => {}),
    }),
  },
  createModuleLogger: () => ({
    error: mock(() => {}),
  }),
}));

const {
  clearPendingPrompts,
  enqueuePrompt,
  listPendingPrompts,
  removePrompt,
  updatePromptStatus,
} = await import('../../storage/chat-local-mobile-pending-prompts');

describe('chat-local-mobile pending prompts', () => {
  beforeEach(() => {
    dbManagerState.ensureOrmCalls = 0;
    storeState.enqueued = [];
    storeState.statusUpdates = [];
    storeState.removed = [];
    storeState.prompts = [];
  });

  it('normalizes invalid queued run payload metadata before enqueueing', async () => {
    await enqueuePrompt('conv-1', 'Write a brief', {
      modelId: 'openai/gpt-5.5',
      attachmentIds: ['att-1', 42, 'att-2'],
    } as any);

    expect(dbManagerState.ensureOrmCalls).toBe(1);
    expect(storeState.enqueued).toEqual([
      {
        conversationId: 'conv-1',
        prompt: 'Write a brief',
        runPayload: {
          prompt: 'Write a brief',
          demo: false,
          modelId: 'openai/gpt-5.5',
          attachment_ids: ['att-1', 'att-2'],
        },
      },
    ]);
  });

  it('returns result-wrapped pending prompts with fallback run payloads', async () => {
    storeState.prompts = [
      {
        id: 7,
        conversationId: 'conv-1',
        prompt: 'Continue',
        status: 'queued',
        createdAt: 123,
      },
    ];

    const result = await listPendingPrompts();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([
        {
          id: 7,
          conversationId: 'conv-1',
          prompt: 'Continue',
          status: 'queued',
          createdAt: 123,
          updatedAt: 123,
          runPayload: undefined,
        },
      ]);
    }
  });

  it('rejects non-numeric prompt identifiers before mutating storage', async () => {
    await expect(updatePromptStatus('7' as any, 'failed')).rejects.toThrow(
      'Invalid prompt ID type: string'
    );
    await expect(removePrompt('7' as any)).rejects.toThrow('Invalid prompt ID type: string');

    expect(storeState.statusUpdates).toEqual([]);
    expect(storeState.removed).toEqual([]);
  });

  it('clears only persisted prompts with numeric identifiers', async () => {
    storeState.prompts = [
      { id: 1, conversationId: 'conv-1', prompt: 'A', status: 'queued', createdAt: 1 },
      { conversationId: 'conv-2', prompt: 'B', status: 'failed', createdAt: 2 },
      { id: 3, conversationId: 'conv-3', prompt: 'C', status: 'running', createdAt: 3 },
    ];

    await clearPendingPrompts();

    expect(storeState.removed).toEqual([1, 3]);
  });
});
