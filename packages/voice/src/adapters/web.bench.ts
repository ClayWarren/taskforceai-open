import { WebVoiceAdapter } from './web';

type BenchmarkCase = {
  name: string;
  run: () => Promise<void>;
};

type UtteranceListener = (event?: { error?: string }) => void;

class BenchmarkUtterance {
  readonly listeners: Record<string, UtteranceListener[]> = {};

  constructor(readonly text: string) {}

  addEventListener(event: string, listener: UtteranceListener): void {
    this.listeners[event] ??= [];
    this.listeners[event].push(listener);
  }
}

Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
  value: BenchmarkUtterance,
  writable: true,
  configurable: true,
});

Object.defineProperty(globalThis, 'window', {
  value: {
    speechSynthesis: {
      cancel: () => {},
      speak: (utterance: BenchmarkUtterance) => {
        utterance.listeners['end']?.forEach((listener) => listener());
      },
    },
  },
  writable: true,
  configurable: true,
});

Object.defineProperty(globalThis, 'navigator', {
  value: {
    mediaDevices: undefined,
  },
  writable: true,
  configurable: true,
});

const adapter = new WebVoiceAdapter();
await adapter.init();

const iterations = Number(process.env['WEB_VOICE_BENCH_ITERATIONS'] ?? '200000');
const warmupIterations = Math.min(10_000, Math.max(1_000, Math.floor(iterations / 20)));

const runBenchmark = async ({ name, run }: BenchmarkCase): Promise<void> => {
  /* eslint-disable no-await-in-loop -- Benchmarks intentionally measure sequential operations. */
  for (let i = 0; i < warmupIterations; i += 1) {
    await run();
  }

  const startedAt = performance.now();
  for (let i = 0; i < iterations; i += 1) {
    await run();
  }
  /* eslint-enable no-await-in-loop */
  const elapsedMs = performance.now() - startedAt;
  const microsecondsPerOp = (elapsedMs * 1_000) / iterations;
  const opsPerSecond = Math.round(iterations / (elapsedMs / 1_000));

  process.stdout.write(
    `${name}: ${microsecondsPerOp.toFixed(3)} us/op (${opsPerSecond.toLocaleString()} ops/sec)\n`
  );
};

const cases: BenchmarkCase[] = [
  {
    name: 'web speak success path',
    run: async () => {
      await adapter.speak('hello from benchmark');
    },
  },
];

process.stdout.write(
  `voice/WebVoiceAdapter performance (${iterations.toLocaleString()} iterations)\n`
);

/* eslint-disable no-await-in-loop -- Benchmark cases are reported sequentially for stable output. */
for (const benchmarkCase of cases) {
  await runBenchmark(benchmarkCase);
}
/* eslint-enable no-await-in-loop */
