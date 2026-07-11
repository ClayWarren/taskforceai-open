import { beforeEach, describe, expect, it, mock } from 'bun:test';

type PromptQueueRow = {
  conversation_id?: string;
  prompt?: string;
  status?: string;
  created_at?: number;
  model_id?: string | null;
  attachment_ids?: string | null;
};

type PendingChangeRow = {
  entity_id?: string;
  created_at?: number;
  data?: string | null;
};

const dbState = {
  tables: [] as string[],
  promptRows: [] as PromptQueueRow[],
  pendingRows: [] as PendingChangeRow[],
  runCalls: [] as Array<{ sql: string; params?: unknown[] }>,
};

const createRawDb = () => ({
  getAllSync: (sql: string) => {
    if (sql.includes('sqlite_master')) {
      return dbState.tables.map((name) => ({ name }));
    }
    if (sql.includes('FROM prompt_queue')) {
      return dbState.promptRows;
    }
    if (sql.includes("FROM pending_changes WHERE type = 'prompt'")) {
      return dbState.pendingRows;
    }
    return [];
  },
  runSync: (sql: string, params?: unknown[]) => {
    dbState.runCalls.push({ sql, params });
  },
});

const resetDbState = () => {
  dbState.tables = [];
  dbState.promptRows = [];
  dbState.pendingRows = [];
  dbState.runCalls = [];
};

mock.module('../../logger', () => ({
  mobileLogger: {
    info: () => {},
  },
}));

const { backfillLegacyPromptQueue } = await import('../../storage/migration-backfill');

describe('migration-backfill', () => {
  beforeEach(() => {
    resetDbState();
  });

  it('does nothing unless both legacy prompt queue and pending changes tables exist', () => {
    dbState.tables = ['prompt_queue'];

    backfillLegacyPromptQueue(createRawDb() as any);

    expect(dbState.runCalls).toEqual([]);
  });

  it('does nothing when the legacy prompt queue is empty', () => {
    dbState.tables = ['prompt_queue', 'pending_changes'];

    backfillLegacyPromptQueue(createRawDb() as any);

    expect(dbState.runCalls).toEqual([]);
  });

  it('skips malformed legacy rows and duplicate pending prompt signatures', () => {
    dbState.tables = ['prompt_queue', 'pending_changes'];
    dbState.promptRows = [
      { prompt: 'missing conversation', created_at: 1 },
      { conversation_id: 'conv-1', prompt: '   ', created_at: 2 },
      { conversation_id: 'conv-1', prompt: 'missing created_at' },
      { conversation_id: 'conv-2', prompt: 'already queued', created_at: 3 },
    ];
    dbState.pendingRows = [
      { entity_id: '', created_at: 3, data: JSON.stringify({ prompt: 'ignored' }) },
      { entity_id: 'conv-2', data: JSON.stringify({ prompt: 'ignored' }) },
      { entity_id: 'conv-2', created_at: 3, data: '' },
      { entity_id: 'conv-2', created_at: 3, data: '{bad json' },
      { entity_id: 'conv-2', created_at: 3, data: JSON.stringify({ prompt: '' }) },
      {
        entity_id: 'conv-2',
        created_at: 3,
        data: JSON.stringify({ prompt: 'already queued' }),
      },
    ];

    backfillLegacyPromptQueue(createRawDb() as any);

    expect(dbState.runCalls).toEqual([]);
  });

  it('backfills valid prompts with normalized status and run payload metadata', () => {
    dbState.tables = ['prompt_queue', 'pending_changes'];
    dbState.promptRows = [
      {
        conversation_id: 'conv-1',
        prompt: 'Run analysis',
        status: 'running',
        created_at: 10,
        model_id: 'openai/gpt-5.6-sol',
        attachment_ids: '[" att-1 ",42,"","   ","att-2"]',
      },
      {
        conversation_id: 'conv-2',
        prompt: 'Retry later',
        status: 'failed',
        created_at: 20,
        model_id: '',
        attachment_ids: '{"not":"an array"}',
      },
      {
        conversation_id: 'conv-3',
        prompt: 'Queued prompt',
        status: 'pending',
        created_at: 30,
        model_id: null,
        attachment_ids: 'not json',
      },
      {
        conversation_id: 'conv-4',
        prompt: 'No attachments',
        status: 'queued',
        created_at: 40,
        model_id: null,
        attachment_ids: '',
      },
    ];

    backfillLegacyPromptQueue(createRawDb() as any);

    expect(dbState.runCalls).toHaveLength(4);
    const firstData = JSON.parse(String(dbState.runCalls[0]?.params?.[3])) as Record<
      string,
      any
    >;
    const secondData = JSON.parse(String(dbState.runCalls[1]?.params?.[3])) as Record<
      string,
      any
    >;
    const thirdData = JSON.parse(String(dbState.runCalls[2]?.params?.[3])) as Record<
      string,
      any
    >;
    const fourthData = JSON.parse(String(dbState.runCalls[3]?.params?.[3])) as Record<
      string,
      any
    >;

    expect(firstData).toEqual({
      prompt: 'Run analysis',
      status: 'queued',
      runPayload: {
        prompt: 'Run analysis',
        demo: false,
        modelId: 'openai/gpt-5.6-sol',
        attachment_ids: ['att-1', 'att-2'],
      },
    });
    expect(secondData).toEqual({
      prompt: 'Retry later',
      status: 'failed',
      runPayload: {
        prompt: 'Retry later',
        demo: false,
      },
    });
    expect(thirdData).toEqual({
      prompt: 'Queued prompt',
      status: 'pending',
      runPayload: {
        prompt: 'Queued prompt',
        demo: false,
      },
    });
    expect(fourthData).toEqual({
      prompt: 'No attachments',
      status: 'queued',
      runPayload: {
        prompt: 'No attachments',
        demo: false,
      },
    });
    expect(dbState.runCalls.map((call) => call.params?.slice(0, 3))).toEqual([
      ['prompt', 'conv-1', 'create'],
      ['prompt', 'conv-2', 'create'],
      ['prompt', 'conv-3', 'create'],
      ['prompt', 'conv-4', 'create'],
    ]);
  });
});
