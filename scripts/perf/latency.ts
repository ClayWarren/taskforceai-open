export interface LatencyStats {
  samples: number;
  minMs: number;
  maxMs: number;
  averageMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

export interface LatencyThresholds {
  p95Ms: number;
  p99Ms: number;
}

export const DEFAULT_API_LATENCY_THRESHOLDS_MS: LatencyThresholds = {
  p95Ms: 3000,
  p99Ms: 5000,
};

const ensureFiniteSample = (sample: number, index: number): void => {
  if (!Number.isFinite(sample) || sample < 0) {
    throw new Error(`Latency sample at index ${index} must be a finite non-negative number`);
  }
};

export const percentile = (sortedSamples: readonly number[], percentileValue: number): number => {
  if (sortedSamples.length === 0) {
    return 0;
  }
  if (!Number.isFinite(percentileValue) || percentileValue < 0 || percentileValue > 100) {
    throw new Error(`Percentile must be between 0 and 100, got ${percentileValue}`);
  }

  const index = Math.max(
    0,
    Math.min(
      sortedSamples.length - 1,
      Math.ceil((percentileValue / 100) * sortedSamples.length) - 1
    )
  );
  return sortedSamples[index] ?? 0;
};

export const calculateLatencyStats = (samplesMs: readonly number[]): LatencyStats => {
  samplesMs.forEach(ensureFiniteSample);

  if (samplesMs.length === 0) {
    return {
      samples: 0,
      minMs: 0,
      maxMs: 0,
      averageMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
    };
  }

  const sorted = samplesMs.toSorted((a, b) => a - b);
  const total = samplesMs.reduce((acc, cur) => acc + cur, 0);

  return {
    samples: samplesMs.length,
    minMs: sorted[0] ?? 0,
    maxMs: sorted[sorted.length - 1] ?? 0,
    averageMs: total / samplesMs.length,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
  };
};

export const latencyThresholdsPassed = (
  stats: Pick<LatencyStats, 'p95Ms' | 'p99Ms'>,
  thresholds: LatencyThresholds
): boolean => stats.p95Ms <= thresholds.p95Ms && stats.p99Ms <= thresholds.p99Ms;
