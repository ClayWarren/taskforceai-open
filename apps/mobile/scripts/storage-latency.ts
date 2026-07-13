import { mock } from 'bun:test';
import { PendingPromptQueueProcessor, type PendingPromptRecord } from '@taskforceai/client-runtime';

import { runLatencyBenchmarkSuite } from '../../../scripts/perf/latency-benchmark';

const logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const storageState = new Map<string, string>();
const prompts = new Map<number, PendingPromptRecord>();
let nextPromptId = 1;
let ensureOrmCalls = 0;

await mock.module('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => storageState.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      storageState.set(key, value);
    },
    removeItem: async (key: string) => {
      storageState.delete(key);
    },
  },
}));

await mock.module('drizzle-orm/expo-sqlite/migrator', () => ({
  migrate: async () => {},
}));

await mock.module('../src/logger', () => ({
  mobileLogger: logger,
  createModuleLogger: () => logger,
}));

await mock.module('../src/storage/database-manager', () => ({
  dbManager: {
    ensureOrm: async () => {
      ensureOrmCalls += 1;
      return {};
    },
  },
}));

await mock.module('../src/storage/chat-local-mobile.internal', () => ({
  mobileConversationStore: {
    enqueuePrompt: async (conversationId: string, prompt: string, runPayload?: unknown) => {
      const id = nextPromptId;
      nextPromptId += 1;
      prompts.set(id, {
        id,
        conversationId,
        prompt,
        status: 'queued',
        createdAt: Date.now(),
        ...(runPayload ? { runPayload: runPayload as PendingPromptRecord['runPayload'] } : {}),
      });
    },
    updatePromptStatus: async (id: number, status: PendingPromptRecord['status']) => {
      const current = prompts.get(id);
      if (current) {
        prompts.set(id, { ...current, status });
      }
    },
    removePrompt: async (id: number) => {
      prompts.delete(id);
    },
    listPendingPrompts: async () =>
      [...prompts.values()].filter((prompt) => prompt.status !== 'failed'),
  },
}));

type RawDb = {
  execSync: (sql: string) => void;
  getAllSync: (sql: string) => unknown[];
  runSync: (sql: string, params?: unknown[]) => void;
};

const createRawDb = (): RawDb => ({
  execSync: () => {},
  getAllSync: (sql: string) => {
    if (sql.includes('sqlite_master')) {
      return [];
    }
    if (sql.includes('table_info')) {
      return [];
    }
    return [];
  },
  runSync: () => {},
});

const resetPromptState = () => {
  prompts.clear();
  nextPromptId = 1;
  ensureOrmCalls = 0;
};

const migrationRunner = await import('../src/storage/migration-runner');
const pendingPromptStorage = await import('../src/storage/chat-local-mobile-pending-prompts');

await runLatencyBenchmarkSuite('mobile storage P1', [
  {
    name: 'sqlite-migration-init',
    run: async () => {
      storageState.clear();
      await migrationRunner.runDrizzleMigrations({} as never, createRawDb() as never);
    },
  },
  {
    name: 'pending-prompt-enqueue',
    run: async () => {
      resetPromptState();
      await pendingPromptStorage.enqueuePrompt('conversation-1', 'Prompt text', {
        prompt: 'Prompt text',
        model: 'openai/gpt-5.6-sol',
        attachment_ids: ['attachment-a'],
      });
      if (ensureOrmCalls === 0) {
        throw new Error('mobile pending prompt enqueue failed');
      }
    },
  },
  {
    name: 'pending-prompt-replay',
    run: async () => {
      resetPromptState();
      await pendingPromptStorage.enqueuePrompt('conversation-1', 'Prompt text', {
        prompt: 'Prompt text',
        model: 'openai/gpt-5.6-sol',
      });

      const processor = new PendingPromptQueueProcessor({
        retryDelaysMs: [],
        logger,
        adapter: {
          listPendingPrompts: async () => {
            const result = await pendingPromptStorage.listPendingPrompts();
            if (!result.ok) {
              throw new Error(result.error.message);
            }
            return result.value;
          },
          updatePromptStatus: async (id, status) => {
            await pendingPromptStorage.updatePromptStatus(id, status);
          },
          removePrompt: async (id) => {
            await pendingPromptStorage.removePrompt(id);
          },
          runTask: async () => ({ task_id: 'task-mobile-1' }),
          startStreaming: async (options) => {
            options.onSettled?.('complete');
            await Promise.resolve();
          },
          invalidatePendingPrompts: () => {},
        },
      });
      processor.setEnvironment({ isOnline: true, isStreaming: false });
      await processor.processPendingPrompts();
      await Promise.resolve();
    },
  },
]);
