import {
  runThroughputBenchmarkSuite,
  type ThroughputBenchmarkCase,
} from '../../../../../scripts/perf/operation-benchmark';
import { createAppLogger } from './createAppLogger';
import { createSentryMetricsCollector } from './metrics';
import { createSentryErrorReporter } from './sentry-reporter';
import { sanitizeEvent } from './sentry-config';

type BenchScope = {
  setLevel: () => void;
  setContext: () => void;
  setExtra: () => void;
  setFingerprint: () => void;
};

const iterations = Number(process.env['OBSERVABILITY_BENCH_ITERATIONS'] ?? '100000');
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

const cases: ThroughputBenchmarkCase[] = [
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

await runThroughputBenchmarkSuite('observability', cases, {
  iterations,
  selectedCase: onlyCase,
});
