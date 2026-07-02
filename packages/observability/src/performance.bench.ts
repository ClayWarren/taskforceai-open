import { createAppLogger } from './createAppLogger';
import { createSentryMetricsCollector } from './metrics';
import { createSentryErrorReporter } from './sentry-reporter';
import { sanitizeEvent } from './sentry-config';

type BenchmarkCase = {
  name: string;
  run: () => void;
};

type BenchScope = {
  setLevel: () => void;
  setContext: () => void;
  setExtra: () => void;
  setFingerprint: () => void;
};

const iterations = Number(process.env['OBSERVABILITY_BENCH_ITERATIONS'] ?? '100000');
const warmupIterations = Math.min(10_000, Math.max(1_000, Math.floor(iterations / 20)));
const onlyCase = process.env['OBSERVABILITY_BENCH_CASE'];

const createSentryEvent = () => {
  const sharedContext = {
    feature: 'billing',
    accessToken: 'access-token',
    nested: {
      refreshToken: 'refresh-token',
      safe: 'value',
    },
  };

  return {
    request: {
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/json',
        'x-correlation-id': 'corr-bench',
      },
      url: 'https://console.taskforceai.chat/billing?inviteToken=secret&plan=pro',
      query_string: 'session=secret&tab=usage',
      data: {
        username: 'bench-user',
        password: 'password',
        context: sharedContext,
      },
    },
    extra: {
      sharedContext,
      attempts: [
        { apiKey: 'api-key', status: 'retry' },
        { apiKey: 'api-key-2', status: 'success' },
      ],
    },
    contexts: {
      auth: sharedContext,
    },
    breadcrumbs: Array.from({ length: 4 }, (_, index) => ({
      category: 'http',
      message: `request ${index}`,
      data: {
        url: `/api/tasks?token=secret-${index}`,
        token: `token-${index}`,
        status: 200,
      },
    })),
  };
};

const reporterPayload = {
  message: 'benchmark failed',
  environment: 'production',
  correlationId: 'corr-bench',
  baseMeta: {
    tenant: 'taskforce',
    accessToken: 'context-token',
  },
  getLogMetadata: () => ({
    runtime: 'server',
    refreshToken: 'refresh-token',
  }),
  meta: {
    error: new Error('boom'),
    nested: {
      password: 'password',
      safe: 'value',
    },
  },
};

const sentryClient = {
  withScope(callback: (scope: BenchScope) => void) {
    callback({
      setLevel() {},
      setContext() {},
      setExtra() {},
      setFingerprint() {},
    });
  },
  captureException() {
    return 'event-id';
  },
  captureMessage() {
    return 'event-id';
  },
};

const reporter = createSentryErrorReporter(sentryClient);
const metrics = createSentryMetricsCollector({
  addBreadcrumb() {},
});

const cases: BenchmarkCase[] = [
  {
    name: 'sanitizeEvent nested sentry event',
    run: () => {
      sanitizeEvent(createSentryEvent() as unknown as Parameters<typeof sanitizeEvent>[0]);
    },
  },
  {
    name: 'createAppLogger test logger',
    run: () => {
      createAppLogger({ app: 'benchmark', isTest: true, enableConsole: false });
    },
  },
  {
    name: 'sentry error reporter nested meta',
    run: () => {
      reporter(reporterPayload);
    },
  },
  {
    name: 'metrics timer breadcrumb',
    run: () => {
      metrics.startTimer('benchmark.operation', { status: 'ok' })();
    },
  },
];

const runBenchmark = ({ name, run }: BenchmarkCase): void => {
  for (let i = 0; i < warmupIterations; i += 1) {
    run();
  }

  const startedAt = performance.now();
  for (let i = 0; i < iterations; i += 1) {
    run();
  }
  const elapsedMs = performance.now() - startedAt;
  const microsecondsPerOp = (elapsedMs * 1_000) / iterations;
  const opsPerSecond = Math.round(iterations / (elapsedMs / 1_000));

  process.stdout.write(
    `${name}: ${microsecondsPerOp.toFixed(3)} us/op (${opsPerSecond.toLocaleString()} ops/sec)\n`
  );
};

process.stdout.write(`observability performance (${iterations.toLocaleString()} iterations)\n`);

for (const benchmarkCase of cases) {
  if (onlyCase && benchmarkCase.name !== onlyCase) {
    continue;
  }
  runBenchmark(benchmarkCase);
}
