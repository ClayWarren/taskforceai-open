import { buildRunFormData, type RunTaskAttachment } from '../src/attachments';
import {
  applyAuthorizationHeader,
  parseErrorPayload,
  parseSuccessPayload,
  resolveBearerToken,
} from '../src/request.utils';
import { ok } from '../src/utils/result';

type BenchmarkCase = {
  name: string;
  operationsPerIteration: number;
  iterations: number;
  run: () => void | Promise<void>;
};

type BenchmarkResult = {
  name: string;
  iterations: number;
  operations: number;
  medianMs: number;
  averageMs: number;
  nsPerOperation: number;
};

const SAMPLE_COUNT = 7;

let checksum = 0;

const jsonPayloads = Array.from({ length: 500 }, (_unused, index) =>
  JSON.stringify({
    task_id: `task-${index}`,
    status: index % 2 === 0 ? 'completed' : 'running',
    result: `Task ${index} finished`,
    conversation_id: index,
    trace_id: `trace-${index}`,
  })
);

const errorPayloads = Array.from({ length: 500 }, (_unused, index) =>
  JSON.stringify({
    errors: [
      { message: `field ${index} is invalid` },
      { message: `field ${index + 1} is required` },
    ],
    detail: `Validation failed ${index}`,
  })
);

const tokenPayloads = Array.from({ length: 1000 }, (_unused, index) =>
  index % 3 === 0
    ? ` token-${index} `
    : index % 3 === 1
      ? { access_token: `access-${index}` }
      : { token: `legacy-${index}`, ignored: true }
);

const runPayload = {
  prompt: 'Analyze the project and produce a concise execution plan',
  conversation_id: 'conversation-1',
  modelId: 'openai/gpt-5.5',
  projectId: 42,
  demo: false,
  role_models: {
    planner: 'openai/gpt-5.5',
    engineer: 'openai/gpt-5.5-codex',
    reviewer: 'anthropic/claude-opus-5',
  },
  attachments: [
    { data: 'image-data', mime_type: 'image/png' as const, name: 'screenshot.png' },
    { data: 'diagram-data', mime_type: 'image/webp' as const, name: 'diagram.webp' },
  ],
  audio_attachments: [{ data: 'audio-data', format: 'wav' as const, name: 'notes.wav' }],
  video_attachments: [{ data: 'video-data', mime_type: 'video/mp4' as const, name: 'clip.mp4' }],
  options: {
    temperature: 0.2,
    idempotencyKey: 'run-1',
    tools: ['search', 'read', 'edit'],
  },
};

const fileAttachments: RunTaskAttachment[] = Array.from({ length: 8 }, (_unused, index) => ({
  uri: `file:///tmp/taskforceai-${index}.txt`,
  name: `artifact-${index}.txt`,
  type: 'text/plain',
}));

const jsonHeaders = { 'Content-Type': 'application/json' };
const errorResponse = new Response(null, { status: 422, statusText: 'Unprocessable Entity' });
const metricLabels = { baseUrl: 'https://api.taskforceai.chat', method: 'GET', path: '/api/v1/me' };
const metrics = {
  incrementCounter: () => {},
  startTimer: () => () => {},
};

const runParseSuccessPayload = async (): Promise<void> => {
  let localChecksum = 0;
  /* eslint-disable no-await-in-loop -- Benchmarks intentionally measure sequential parsing. */
  for (const payload of jsonPayloads) {
    const parsed = await parseSuccessPayload<{ task_id: string }>(
      new Response(payload, {
        status: 200,
        headers: jsonHeaders,
      }),
      true
    );
    localChecksum += parsed.task_id.length;
  }
  /* eslint-enable no-await-in-loop */
  checksum += localChecksum;
};

const runParseErrorPayload = (): void => {
  let localChecksum = 0;
  for (const payload of errorPayloads) {
    const parsed = parseErrorPayload(errorResponse, payload);
    localChecksum += parsed.message.length;
  }
  checksum += localChecksum;
};

const runResolveBearerToken = (): void => {
  let localChecksum = 0;
  for (const payload of tokenPayloads) {
    const token = resolveBearerToken(payload);
    localChecksum += token.ok ? token.value.length : 0;
  }
  checksum += localChecksum;
};

const runApplyAuthorizationHeader = async (): Promise<void> => {
  let localChecksum = 0;
  /* eslint-disable no-await-in-loop -- Benchmarks intentionally measure sequential header writes. */
  for (const payload of tokenPayloads) {
    const headers = new Headers();
    await applyAuthorizationHeader(headers, metricLabels, metrics, async () => ok(payload));
    localChecksum += headers.get('Authorization')?.length ?? 0;
  }
  /* eslint-enable no-await-in-loop */
  checksum += localChecksum;
};

const runBuildRunFormData = (): void => {
  let localChecksum = 0;
  for (let index = 0; index < 500; index += 1) {
    const formData = buildRunFormData(runPayload, fileAttachments);
    const prompt = formData.get('prompt');
    localChecksum += typeof prompt === 'string' ? prompt.length : 0;
    localChecksum += formData.getAll('files').length;
  }
  checksum += localChecksum;
};

const cases: BenchmarkCase[] = [
  {
    name: 'parse-success-json',
    operationsPerIteration: jsonPayloads.length,
    iterations: 100,
    run: runParseSuccessPayload,
  },
  {
    name: 'parse-error-json',
    operationsPerIteration: errorPayloads.length,
    iterations: 300,
    run: runParseErrorPayload,
  },
  {
    name: 'resolve-bearer-token',
    operationsPerIteration: tokenPayloads.length,
    iterations: 1000,
    run: runResolveBearerToken,
  },
  {
    name: 'apply-authorization-header',
    operationsPerIteration: tokenPayloads.length,
    iterations: 250,
    run: runApplyAuthorizationHeader,
  },
  {
    name: 'build-run-form-data',
    operationsPerIteration: 500,
    iterations: 200,
    run: runBuildRunFormData,
  },
];

const median = (values: number[]): number => {
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const runBenchmark = async (benchmark: BenchmarkCase): Promise<BenchmarkResult> => {
  /* eslint-disable no-await-in-loop -- Benchmarks intentionally measure sequential operations. */
  for (let index = 0; index < 3; index += 1) {
    await benchmark.run();
  }

  const sampleMs: number[] = [];
  for (let sampleIndex = 0; sampleIndex < SAMPLE_COUNT; sampleIndex += 1) {
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

const selectedCase = Bun.argv.find((arg) => arg.startsWith('--case='))?.slice('--case='.length);
const selectedBenchmarks = selectedCase
  ? cases.filter((benchmark) => benchmark.name === selectedCase)
  : cases;

if (selectedBenchmarks.length === 0) {
  throw new Error(`Unknown benchmark case: ${selectedCase}`);
}

console.log('contracts-ts performance benchmark');
console.log(`samples=${SAMPLE_COUNT}`);

/* eslint-disable no-await-in-loop -- Benchmark cases are reported sequentially for stable output. */
for (const benchmark of selectedBenchmarks) {
  const result = await runBenchmark(benchmark);
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

console.log(`checksum=${checksum}`);
