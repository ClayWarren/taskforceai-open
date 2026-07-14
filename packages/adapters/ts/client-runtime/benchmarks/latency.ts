import { ok } from '@taskforceai/client-core/result';

import {
  createStreamingStore,
  PendingPromptQueueProcessor,
  submitStreamingPrompt,
  type PendingPromptRecord,
} from '../src';
import { runLatencyBenchmarkSuite } from '../../../../../scripts/perf/latency-benchmark';

const logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const pendingPrompt = (): PendingPromptRecord => ({
  id: 1,
  conversationId: 'conversation-1',
  prompt: 'Summarize the current project state',
  createdAt: 1_700_000_000_000,
  status: 'queued',
  runPayload: {
    prompt: 'Summarize the current project state',
    model: 'openai/gpt-5.6-sol',
    attachment_ids: ['attachment-a'],
  },
});

const samplePendingQueueReplay = async (): Promise<void> => {
  let prompts = [pendingPrompt()];
  const processor = new PendingPromptQueueProcessor({
    retryDelaysMs: [],
    logger,
    adapter: {
      listPendingPrompts: async () => prompts,
      updatePromptStatus: async (id, status) => {
        prompts = prompts.map((prompt) => (prompt.id === id ? { ...prompt, status } : prompt));
      },
      removePrompt: async (id) => {
        prompts = prompts.filter((prompt) => prompt.id !== id);
      },
      runTask: async () => ({ task_id: 'task-1' }),
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
};

const samplePendingQueueEmptyDrain = async (): Promise<void> => {
  const processor = new PendingPromptQueueProcessor({
    retryDelaysMs: [],
    logger,
    adapter: {
      listPendingPrompts: async () => [],
      updatePromptStatus: async () => {},
      removePrompt: async () => {},
      runTask: async () => ({ task_id: 'task-empty' }),
      startStreaming: async () => {},
      invalidatePendingPrompts: () => {},
    },
  });
  processor.setEnvironment({ isOnline: true, isStreaming: false });
  await processor.processPendingPrompts();
};

const sampleSubmitStreamingPrompt = async (): Promise<void> => {
  const result = await submitStreamingPrompt({
    prompt: 'Analyze this issue',
    attachment_ids: ['attachment-a'],
    modelId: 'openai/gpt-5.6-sol',
    ensureConversationId: async () => 'conversation-1',
    enqueuePrompt: async () => {},
    prepareStreaming: () => {},
    failPreparedStreaming: () => {},
    startStreaming: async () => {},
    onSendMessage: () => {},
    onConversationId: () => {},
    onApproval: () => {},
    buildRateLimitMessage: () => 'rate limited',
    readRateLimitResetTime: () => undefined,
    isOffline: () => false,
    runTask: async () => ok({ task_id: 'task-1', status: 'queued' }),
    logger: { warn: () => {} },
  });
  if (!result.ok) {
    throw new Error(`submitStreamingPrompt failed: ${result.error.kind}`);
  }
};

const sampleRetryAfterStreamFailure = async (): Promise<void> => {
  let queued = false;
  const result = await submitStreamingPrompt({
    prompt: 'Analyze this issue',
    modelId: 'openai/gpt-5.6-sol',
    ensureConversationId: async () => 'conversation-1',
    enqueuePrompt: async () => {
      queued = true;
    },
    prepareStreaming: () => {},
    failPreparedStreaming: () => {},
    startStreaming: async () => {
      throw new Error('Streaming failed');
    },
    onSendMessage: () => {},
    onConversationId: () => {},
    onApproval: () => {},
    buildRateLimitMessage: () => 'rate limited',
    readRateLimitResetTime: () => undefined,
    isOffline: () => true,
    runTask: async () => ok({ task_id: 'task-1', status: 'queued' }),
    logger: { warn: () => {} },
  });
  if (!result.ok || !queued) {
    throw new Error('stream failure did not queue prompt fallback');
  }
};

const sampleStreamingStoreStart = async (): Promise<void> => {
  const store = createStreamingStore({
    logger,
    connect: async (_taskId, _onMessage, _onError, onOpen) => {
      onOpen?.();
      return () => {};
    },
  });
  await store.getState().startStreaming({
    taskId: 'task-1',
    conversationId: 'conversation-1',
    prompt: 'Analyze this issue',
    agentCount: 2,
  });
  store.getState().stopStreaming();
};

await runLatencyBenchmarkSuite('client-runtime P1', [
  { name: 'pending-prompt-queue-empty-drain', run: samplePendingQueueEmptyDrain },
  { name: 'pending-prompt-queue-replay', run: samplePendingQueueReplay },
  { name: 'submit-streaming-prompt', run: sampleSubmitStreamingPrompt },
  { name: 'retry-after-stream-failure', run: sampleRetryAfterStreamFailure },
  { name: 'streaming-store-start', run: sampleStreamingStoreStart },
]);
