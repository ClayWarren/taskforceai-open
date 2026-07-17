import { ok } from '@taskforceai/client-core/result';
import { createStreamingStore, submitStreamingPrompt } from '@taskforceai/client-runtime';

import { runLatencyBenchmarkSuite, sleepMs } from '../../../../scripts/perf/latency-benchmark';
import { createDesktopStreamingRuntime } from '../platform/streaming-runtime';

const FIRST_TOKEN = 'Seeded desktop TTFT token';
const FIXTURE_DELAY_MS = Number(process.env['CLIENT_TTFT_FIXTURE_DELAY_MS'] ?? 15);
const SAMPLES = Number(process.env['CLIENT_TTFT_SAMPLES'] ?? 20);
const WARMUP = Number(process.env['CLIENT_TTFT_WARMUP'] ?? 3);

const logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const seededRun = (id: string, status: 'completed' | 'canceled') => ({
  run: {
    id,
    prompt: 'Measure desktop TTFT',
    status,
    output: status === 'completed' ? FIRST_TOKEN : null,
    error: null,
    createdAt: 1,
    updatedAt: 1,
  },
});

interface DesktopTTFTSample {
  ttftMs: number;
  firstContentStateMs: number;
}

const sampleDesktopTTFT = async (): Promise<DesktopTTFTSample> => {
  let resolveTTFT!: (value: number) => void;
  let resolveContentState!: (value: number) => void;
  const ttft = new Promise<number>((resolve) => {
    resolveTTFT = resolve;
  });
  const firstContentState = new Promise<number>((resolve) => {
    resolveContentState = resolve;
  });
  let startedAt = 0;

  const runtime = createDesktopStreamingRuntime({
    waitForBridge: async () => true,
    cancelRun: async (taskId) => seededRun(taskId, 'canceled'),
    getRunStatus: async (taskId) => {
      await sleepMs(FIXTURE_DELAY_MS);
      return seededRun(taskId, 'completed');
    },
  });

  const store = createStreamingStore({
    logger,
    reportLatencyMark: (name) => {
      if (name === 'streaming.ttft') {
        resolveTTFT(performance.now() - startedAt);
      }
    },
    connect: async (taskId, onMessage, onError, onOpen) => {
      await runtime.startStreaming(taskId, { onMessage, onError, onOpen });
      return () => runtime.stopStreaming();
    },
  });

  const unsubscribe = store.subscribe((state) => {
    if (state.streamContent === FIRST_TOKEN) {
      resolveContentState(performance.now() - startedAt);
    }
  });

  try {
    startedAt = performance.now();
    const result = await submitStreamingPrompt({
      prompt: 'Measure desktop TTFT',
      modelId: 'openai/gpt-5.6-sol',
      ensureConversationId: async () => 'desktop-ttft-conversation',
      enqueuePrompt: async () => {},
      prepareStreaming: (options) => store.getState().prepareStreaming(options),
      failPreparedStreaming: (message, resetTime) =>
        store.getState().failPreparedStreaming(message, resetTime),
      startStreaming: (options) => store.getState().startStreaming(options),
      onSendMessage: () => {},
      onConversationId: () => {},
      onApproval: () => {},
      buildRateLimitMessage: () => 'rate limited',
      readRateLimitResetTime: () => undefined,
      isOffline: () => false,
      runTask: async () => ok({ task_id: 'desktop-ttft-task', status: 'queued' }),
      logger: { warn: () => {} },
    });
    if (!result.ok) {
      throw new Error(`desktop TTFT prompt failed: ${result.error.kind}`);
    }
    const [ttftMs, firstContentStateMs] = await Promise.all([ttft, firstContentState]);
    return { ttftMs, firstContentStateMs };
  } finally {
    unsubscribe();
    store.getState().stopStreaming();
  }
};

await runLatencyBenchmarkSuite('desktop seeded TTFT P1', [
  {
    name: 'desktop-submit-to-first-token',
    samples: SAMPLES,
    warmup: WARMUP,
    sample: async () => (await sampleDesktopTTFT()).ttftMs,
  },
  {
    name: 'desktop-submit-to-first-content-state',
    samples: SAMPLES,
    warmup: WARMUP,
    sample: async () => (await sampleDesktopTTFT()).firstContentStateMs,
  },
]);
