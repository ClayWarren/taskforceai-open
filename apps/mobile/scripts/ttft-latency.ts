import { ok } from '@taskforceai/client-core/result';
import { createStreamingStore, submitStreamingPrompt } from '@taskforceai/client-runtime';

import { runLatencyBenchmarkSuite, sleepMs } from '../../../scripts/perf/latency-benchmark';
import { reportOptionalLatencyMark } from '../src/observability/latency';

const FIRST_TOKEN = 'Seeded mobile TTFT token';
const FIXTURE_DELAY_MS = Number(process.env['CLIENT_TTFT_FIXTURE_DELAY_MS'] ?? 15);
const SAMPLES = Number(process.env['CLIENT_TTFT_SAMPLES'] ?? 100);
const WARMUP = Number(process.env['CLIENT_TTFT_WARMUP'] ?? 5);

const logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

interface MobileTTFTSample {
  ttftMs: number;
  firstContentStateMs: number;
}

const sampleMobileTTFT = async (): Promise<MobileTTFTSample> => {
  let resolveTTFT!: (value: number) => void;
  let resolveContentState!: (value: number) => void;
  const ttft = new Promise<number>((resolve) => {
    resolveTTFT = resolve;
  });
  const firstContentState = new Promise<number>((resolve) => {
    resolveContentState = resolve;
  });
  let startedAt = 0;

  const store = createStreamingStore({
    logger,
    reportLatencyMark: (name, detail) => {
      reportOptionalLatencyMark(name, detail);
      if (name === 'streaming.ttft') {
        resolveTTFT(performance.now() - startedAt);
      }
    },
    connect: async (_taskId, onMessage, _onError, onOpen) => {
      onOpen?.();
      void sleepMs(FIXTURE_DELAY_MS).then(() => {
        onMessage(JSON.stringify({ type: 'progress', chunk: FIRST_TOKEN }));
      });
      return () => {};
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
      prompt: 'Measure mobile TTFT',
      modelId: 'openai/gpt-5.6-sol',
      ensureConversationId: async () => 'mobile-ttft-conversation',
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
      runTask: async () => ok({ task_id: 'mobile-ttft-task', status: 'queued' }),
      logger: { warn: () => {} },
    });
    if (!result.ok) {
      throw new Error(`mobile TTFT prompt failed: ${result.error.kind}`);
    }
    const [ttftMs, firstContentStateMs] = await Promise.all([ttft, firstContentState]);
    return { ttftMs, firstContentStateMs };
  } finally {
    unsubscribe();
    store.getState().stopStreaming();
  }
};

await runLatencyBenchmarkSuite('mobile seeded TTFT P1', [
  {
    name: 'mobile-submit-to-first-token',
    samples: SAMPLES,
    warmup: WARMUP,
    sample: async () => (await sampleMobileTTFT()).ttftMs,
  },
  {
    name: 'mobile-submit-to-first-content-state',
    samples: SAMPLES,
    warmup: WARMUP,
    sample: async () => (await sampleMobileTTFT()).firstContentStateMs,
  },
]);
