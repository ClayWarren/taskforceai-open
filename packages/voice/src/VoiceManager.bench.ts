import { VoiceManager } from './VoiceManager';
import type { VoiceAdapter } from './types';

type BenchmarkCase = {
  name: string;
  run: () => Promise<void>;
};

const readyAdapter: VoiceAdapter = {
  async init(): Promise<void> {},
  async speak(_text: string): Promise<void> {},
  async listen(): Promise<string> {
    return 'benchmark transcript';
  },
  async record(): Promise<{ data: string; format: string }> {
    return { data: 'benchmark-audio', format: 'wav' };
  },
  async cancel(): Promise<void> {},
};

const manager = new VoiceManager(readyAdapter);
await manager.init();

const iterations = Number(process.env['VOICE_MANAGER_BENCH_ITERATIONS'] ?? '200000');
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
    name: 'ready speak success path',
    run: async () => {
      await manager.speak('hello from benchmark');
    },
  },
  {
    name: 'ready listen success path',
    run: async () => {
      await manager.listen();
    },
  },
  {
    name: 'ready record success path',
    run: async () => {
      await manager.record();
    },
  },
];

process.stdout.write(
  `voice/VoiceManager performance (${iterations.toLocaleString()} iterations)\n`
);

/* eslint-disable no-await-in-loop -- Benchmark cases are reported sequentially for stable output. */
for (const benchmarkCase of cases) {
  await runBenchmark(benchmarkCase);
}
/* eslint-enable no-await-in-loop */
