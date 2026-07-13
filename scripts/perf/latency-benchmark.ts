import { calculateLatencyStats, type LatencyStats } from './latency';

export interface LatencyBenchmarkCase {
  name: string;
  samples?: number;
  warmup?: number;
  run?: () => void | Promise<void>;
  sample?: () => number | Promise<number>;
}

export interface LatencyBenchmarkResult {
  name: string;
  stats: LatencyStats;
}

export const sleepMs = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const sampleLatency = async (benchmark: LatencyBenchmarkCase): Promise<number> => {
  if (benchmark.sample) {
    return benchmark.sample();
  }
  if (!benchmark.run) {
    throw new Error(`Latency benchmark ${benchmark.name} must define run or sample`);
  }

  const start = performance.now();
  await benchmark.run();
  return performance.now() - start;
};

export const collectLatencySamples = async (benchmark: LatencyBenchmarkCase): Promise<number[]> => {
  const warmup = benchmark.warmup ?? 5;
  const samples = benchmark.samples ?? 100;

  /* eslint-disable no-await-in-loop -- Benchmarks intentionally collect sequential samples. */
  for (let index = 0; index < warmup; index += 1) {
    await sampleLatency(benchmark);
  }

  const values: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    values.push(await sampleLatency(benchmark));
  }
  /* eslint-enable no-await-in-loop */

  return values;
};

export const runLatencyBenchmarkSuite = async (
  suiteName: string,
  cases: readonly LatencyBenchmarkCase[]
): Promise<LatencyBenchmarkResult[]> => {
  const selectedCase = Bun.argv.find((arg) => arg.startsWith('--case='))?.slice('--case='.length);
  const selectedCases = selectedCase
    ? cases.filter((benchmark) => benchmark.name === selectedCase)
    : cases;

  if (selectedCases.length === 0) {
    throw new Error(`Unknown benchmark case: ${selectedCase}`);
  }

  console.log(`${suiteName} latency benchmark`);

  const results: LatencyBenchmarkResult[] = [];
  /* eslint-disable no-await-in-loop -- Benchmark cases are reported sequentially for stable output. */
  for (const benchmark of selectedCases) {
    const samples = await collectLatencySamples(benchmark);
    const stats = calculateLatencyStats(samples);
    results.push({ name: benchmark.name, stats });
    console.log(
      [
        benchmark.name,
        `samples=${stats.samples}`,
        `p50=${stats.p50Ms.toFixed(3)}ms`,
        `p95=${stats.p95Ms.toFixed(3)}ms`,
        `p99=${stats.p99Ms.toFixed(3)}ms`,
        `avg=${stats.averageMs.toFixed(3)}ms`,
        `min=${stats.minMs.toFixed(3)}ms`,
        `max=${stats.maxMs.toFixed(3)}ms`,
      ].join(' ')
    );
  }
  /* eslint-enable no-await-in-loop */

  return results;
};
