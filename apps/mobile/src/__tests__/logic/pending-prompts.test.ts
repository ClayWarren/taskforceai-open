import { beforeEach, describe, expect, it, mock } from 'bun:test';

const dbManagerState = {
  ensureOrmCalls: 0,
};

const storeState = {
  enqueued: [] as Array<{ conversationId: string; prompt: string; runPayload: unknown }>,
  statusUpdates: [] as Array<{ id: number; status: string }>,
  removed: [] as number[],
  throwMethod: null as
    | 'enqueuePrompt'
    | 'updatePromptStatus'
    | 'removePrompt'
    | 'listPendingPrompts'
    | null,
  prompts: [] as Array<{
    id?: number;
    conversationId: string;
    prompt: string;
    status: 'queued' | 'running' | 'failed';
    createdAt: number;
    runPayload?: unknown;
  }>,
};

const maybeThrowStoreError = (method: NonNullable<typeof storeState.throwMethod>) => {
  if (storeState.throwMethod === method) {
    throw new Error(`${method} failed`);
  }
};

mock.module('../../storage/database-manager', () => ({
  dbManager: {
    ensureOrm: async () => {
      dbManagerState.ensureOrmCalls += 1;
    },
  },
}));

mock.module('../../storage/conversations/internal', () => ({
  mobileConversationStore: {
    enqueuePrompt: async (conversationId: string, prompt: string, runPayload: unknown) => {
      maybeThrowStoreError('enqueuePrompt');
      storeState.enqueued.push({ conversationId, prompt, runPayload });
    },
    updatePromptStatus: async (id: number, status: string) => {
      maybeThrowStoreError('updatePromptStatus');
      storeState.statusUpdates.push({ id, status });
    },
    removePrompt: async (id: number) => {
      maybeThrowStoreError('removePrompt');
      storeState.removed.push(id);
    },
    listPendingPrompts: async () => {
      maybeThrowStoreError('listPendingPrompts');
      return storeState.prompts;
    },
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
} = await import('../../storage/conversations/pending-prompts');

describe('chat-local-mobile pending prompts', () => {
  beforeEach(() => {
    dbManagerState.ensureOrmCalls = 0;
    storeState.enqueued = [];
    storeState.statusUpdates = [];
    storeState.removed = [];
    storeState.throwMethod = null;
    storeState.prompts = [];
  });

  it('normalizes invalid queued run payload metadata before enqueueing', async () => {
    await enqueuePrompt('conv-1', 'Write a brief', {
      modelId: 'openai/gpt-5.6-sol',
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
          modelId: 'openai/gpt-5.6-sol',
          attachment_ids: ['att-1', 'att-2'],
        },
      },
    ]);
  });

  it('updates and removes numeric pending prompt identifiers', async () => {
    await updatePromptStatus(7, 'running');
    await removePrompt(8);

    expect(dbManagerState.ensureOrmCalls).toBe(2);
    expect(storeState.statusUpdates).toEqual([{ id: 7, status: 'running' }]);
    expect(storeState.removed).toEqual([8]);
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

  it('returns an error result when listing pending prompts fails', async () => {
    storeState.throwMethod = 'listPendingPrompts';

    const result = await listPendingPrompts();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('listPendingPrompts failed');
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

  it('rethrows storage failures from prompt mutations', async () => {
    storeState.throwMethod = 'enqueuePrompt';
    await expect(enqueuePrompt('conv-1', 'Prompt')).rejects.toThrow('enqueuePrompt failed');

    storeState.throwMethod = 'updatePromptStatus';
    await expect(updatePromptStatus(1, 'failed')).rejects.toThrow('updatePromptStatus failed');

    storeState.throwMethod = 'removePrompt';
    await expect(removePrompt(1)).rejects.toThrow('removePrompt failed');
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

  it('rethrows failures while clearing pending prompts', async () => {
    storeState.prompts = [
      { id: 1, conversationId: 'conv-1', prompt: 'A', status: 'queued', createdAt: 1 },
    ];
    storeState.throwMethod = 'removePrompt';

    await expect(clearPendingPrompts()).rejects.toThrow('removePrompt failed');
  });
});
