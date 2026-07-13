/* eslint-disable no-await-in-loop */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { postProcess } from '../scripts/generate';

type BenchmarkResult = {
  averageMs: number;
  checksum: number;
  iterations: number;
  medianMs: number;
  msPerOperationAverage: number;
  msPerOperationMedian: number;
  name: string;
  sampleCount: number;
  samplesMs: number[];
};

const sampleCount = Number(process.env['DB_SYNC_BENCH_SAMPLES'] ?? '9');
const iterations = Number(process.env['DB_SYNC_BENCH_ITERATIONS'] ?? '20');
const warmupSamples = Number(process.env['DB_SYNC_BENCH_WARMUP_SAMPLES'] ?? '3');
const schemaSource = path.resolve(import.meta.dir, '../drizzle/schema.ts');

let checksum = 0;

const median = (values: number[]) => {
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const runSample = async (sampleName: string) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `db-sync-postprocess-${sampleName}-`));
  try {
    const startedAt = performance.now();
    for (let index = 0; index < iterations; index += 1) {
      const schemaCopy = path.join(dir, `schema-${index}.ts`);
      fs.copyFileSync(schemaSource, schemaCopy);
      const processed = await postProcess(schemaCopy);
      checksum += processed ? 1 : 0;
      checksum += fs.statSync(schemaCopy).size;
    }
    return performance.now() - startedAt;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

for (let index = 0; index < warmupSamples; index += 1) {
  await runSample(`warmup-${index}`);
}

const samplesMs: number[] = [];
for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
  samplesMs.push(await runSample(String(sampleIndex)));
}

const medianMs = median(samplesMs);
const averageMs = samplesMs.reduce((sum, value) => sum + value, 0) / samplesMs.length;

const result: BenchmarkResult = {
  averageMs,
  checksum,
  iterations,
  medianMs,
  msPerOperationAverage: averageMs / iterations,
  msPerOperationMedian: medianMs / iterations,
  name: 'postProcess generated schema',
  sampleCount,
  samplesMs,
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
