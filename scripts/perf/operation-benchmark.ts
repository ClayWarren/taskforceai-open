export type OperationBenchmarkCase = {
  name: string;
  operationsPerIteration: number;
  iterations: number;
  run: () => void | Promise<void>;
};

export type OperationBenchmarkResult = {
  name: string;
  iterations: number;
  operations: number;
  medianMs: number;
  averageMs: number;
  nsPerOperation: number;
};

export type ThroughputBenchmarkCase = {
  name: string;
  run: () => void | Promise<void>;
};

type OperationBenchmarkSuiteOptions = {
  sampleCount?: number;
  headerLines?: readonly string[];
};

type ThroughputBenchmarkSuiteOptions = {
  iterations: number;
  warmupIterations?: number;
  selectedCase?: string;
};

const DEFAULT_SAMPLE_COUNT = 7;

const selectedCaseArg = (): string | undefined =>
  Bun.argv.find((arg) => arg.startsWith('--case='))?.slice('--case='.length);

const median = (values: number[]): number => {
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const selectCases = <TCase extends { name: string }>(
  cases: readonly TCase[],
  selectedCase = selectedCaseArg()
): readonly TCase[] => {
  const selectedCases = selectedCase
    ? cases.filter((benchmark) => benchmark.name === selectedCase)
    : cases;

  if (selectedCases.length === 0) {
    throw new Error(`Unknown benchmark case: ${selectedCase}`);
  }

  return selectedCases;
};

const runOperationBenchmark = async (
  benchmark: OperationBenchmarkCase,
  sampleCount: number
): Promise<OperationBenchmarkResult> => {
  /* eslint-disable no-await-in-loop -- Benchmarks intentionally measure sequential operations. */
  for (let index = 0; index < 3; index += 1) {
    await benchmark.run();
  }

  const sampleMs: number[] = [];
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const start = performance.now();
    for (let index = 0; index < benchmark.iterations; index += 1) {
      await benchmark.run();
    }
    sampleMs.push(performance.now() - start);
  }
  /* eslint-enable no-await-in-loop */

  const operations = benchmark.iterations * benchmark.operationsPerIteration;
  const medianMs = median(sampleMs);
  const averageMs = sampleMs.reduce((sum, value) => sum + value, 0) / sampleMs.length;

  return {
    name: benchmark.name,
    iterations: benchmark.iterations,
    operations,
    medianMs,
    averageMs,
    nsPerOperation: (medianMs * 1_000_000) / operations,
  };
};

export const runOperationBenchmarkSuite = async (
  suiteName: string,
  cases: readonly OperationBenchmarkCase[],
  options: OperationBenchmarkSuiteOptions = {}
): Promise<OperationBenchmarkResult[]> => {
  const sampleCount = options.sampleCount ?? DEFAULT_SAMPLE_COUNT;
  const selectedBenchmarks = selectCases(cases);

  console.log(`${suiteName} performance benchmark`);
  for (const line of options.headerLines ?? []) {
    console.log(line);
  }
  console.log(`samples=${sampleCount}`);

  const results: OperationBenchmarkResult[] = [];
  /* eslint-disable no-await-in-loop -- Benchmark cases are reported sequentially for stable output. */
  for (const benchmark of selectedBenchmarks) {
    const result = await runOperationBenchmark(benchmark, sampleCount);
    results.push(result);
    console.log(
      [
        result.name,
        `iterations=${result.iterations}`,
        `operations=${result.operations}`,
        `median=${result.medianMs.toFixed(3)}ms`,
        `average=${result.averageMs.toFixed(3)}ms`,
        `ns/op=${result.nsPerOperation.toFixed(1)}`,
      ].join(' ')
    );
  }
  /* eslint-enable no-await-in-loop */

  return results;
};

const runThroughputBenchmark = async (
  { name, run }: ThroughputBenchmarkCase,
  iterations: number,
  warmupIterations: number
): Promise<void> => {
  /* eslint-disable no-await-in-loop -- Benchmarks intentionally measure sequential operations. */
  for (let index = 0; index < warmupIterations; index += 1) {
    await run();
  }

  const startedAt = performance.now();
  for (let index = 0; index < iterations; index += 1) {
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

export const runThroughputBenchmarkSuite = async (
  suiteName: string,
  cases: readonly ThroughputBenchmarkCase[],
  options: ThroughputBenchmarkSuiteOptions
): Promise<void> => {
  const warmupIterations =
    options.warmupIterations ??
    Math.min(10_000, Math.max(1_000, Math.floor(options.iterations / 20)));
  const selectedBenchmarks = selectCases(cases, options.selectedCase);

  process.stdout.write(
    `${suiteName} performance (${options.iterations.toLocaleString()} iterations)\n`
  );

  /* eslint-disable no-await-in-loop -- Benchmark cases are reported sequentially for stable output. */
  for (const benchmarkCase of selectedBenchmarks) {
    await runThroughputBenchmark(benchmarkCase, options.iterations, warmupIterations);
  }
  /* eslint-enable no-await-in-loop */
};
