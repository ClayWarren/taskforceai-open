import {
  createHttpSyncClient,
  SyncManager,
  type BroadcastEvent,
  type SyncClient,
  type SyncMetricsCollector,
  type SyncPullResponse,
  type SyncStorage,
} from '../src';
import { runLatencyBenchmarkSuite, sleepMs } from '../../../scripts/perf/latency-benchmark';

type MetricTags = Record<string, string | number | boolean | undefined>;

class RecordingMetrics implements SyncMetricsCollector {
  readonly timers = new Map<string, number[]>();

  incrementCounter(_name: string, _tags?: MetricTags): void {}

  startTimer(name: string, _tags?: MetricTags): () => void {
    const start = performance.now();
    return () => {
      const values = this.timers.get(name) ?? [];
      values.push(performance.now() - start);
      this.timers.set(name, values);
    };
  }

  lastTimer(name: string): number {
    const values = this.timers.get(name) ?? [];
    const value = values.at(-1);
    if (value === undefined) {
      throw new Error(`Missing timer sample for ${name}`);
    }
    return value;
  }
}

const emptyPullResponse = (version = 1): SyncPullResponse => ({
  conversations: [],
  messages: [],
  deletions: [],
  latest_version: version,
  has_more: false,
  state_hash: `state-${version}`,
});

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const createMockFetch = (delayMs = 1): typeof fetch =>
  (() => {
    const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
      await sleepMs(delayMs);
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.endsWith('/api/v1/sync/status')) {
        return jsonResponse({
          last_synced_at: new Date(1_700_000_000_000).toISOString(),
          sync_version: 1,
          pending_changes: 0,
        });
      }
      if (url.endsWith('/api/v1/sync/pull')) {
        return jsonResponse(emptyPullResponse(2));
      }
      if (url.endsWith('/api/v1/sync/push')) {
        return jsonResponse({
          accepted: [],
          conflicts: [],
          new_version: 3,
          conversation_id_mappings: {},
        });
      }
      if (url.endsWith('/api/v1/sync/realtime/token')) {
        return jsonResponse({ token: 'sync-token', expires_in: 120 });
      }
      if (url.includes('/api/v1/sync/realtime?')) {
        return jsonResponse({
          messages: [
            {
              id: '1-0',
              type: 'sync_required',
              version: 1,
              userId: 'user-1',
            },
          ],
          lastId: '1-0',
        });
      }
      return new Response('not found', { status: 404 });
    };
    const typedFetch = fetchImpl as typeof fetch;
    typedFetch.preconnect = () => {};
    return typedFetch;
  })();

const createClient = (metrics = new RecordingMetrics()): SyncClient =>
  createHttpSyncClient('https://sync.local', async () => 'token', {
    fetchImpl: createMockFetch(),
    metrics,
    resilience: {
      retryAttempts: 1,
      timeoutMs: 1000,
      baseDelayMs: 1,
      maxDelayMs: 1,
      jitterMs: 0,
    },
  });

const waitForRealtimeEvent = async (): Promise<RecordingMetrics> => {
  const metrics = new RecordingMetrics();
  const realtimeClient = createHttpSyncClient('https://sync.local', async () => 'token', {
    fetchImpl: createMockFetch(),
    metrics,
    resilience: { retryAttempts: 1, timeoutMs: 1000, baseDelayMs: 1, maxDelayMs: 1, jitterMs: 0 },
  });

  let disconnect: (() => void) | undefined;
  const delivered = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for realtime poll')), 500);
    disconnect = realtimeClient.connectRealtime((event: BroadcastEvent) => {
      if (event.type === 'sync:required') {
        clearTimeout(timeout);
        resolve();
      }
    });
  });

  try {
    await delivered;
  } finally {
    disconnect?.();
  }

  return metrics;
};

const createStorage = (): SyncStorage => ({
  getConversations: async () => [],
  getConversation: async () => ({ ok: false, error: new Error('missing') }),
  upsertConversation: async () => {},
  deleteConversation: async () => {},
  replaceConversationId: async () => {},
  getMessages: async () => [],
  getMessage: async () => ({ ok: false, error: new Error('missing') }),
  upsertMessage: async () => {},
  deleteMessage: async () => {},
  getPendingChanges: async () => [],
  addPendingChange: async () => {},
  updatePendingChange: async () => {},
  removePendingChange: async () => {},
  clearPendingChanges: async () => {},
  updatePendingChangeData: async () => {},
  getLastSyncVersion: async () => 0,
  setLastSyncVersion: async () => {},
  getDeviceId: async () => 'device-1',
  setDeviceId: async () => {},
});

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const sampleQueuedSync = async (): Promise<number> => {
  const originalInfo = console.info;
  const originalLog = console.log;
  console.info = () => {};
  console.log = () => {};
  const firstPull = createDeferred<SyncPullResponse>();
  let pullCount = 0;
  try {
    const syncClient: SyncClient = {
      pull: async () => {
        pullCount += 1;
        if (pullCount === 1) {
          return firstPull.promise;
        }
        return emptyPullResponse(2);
      },
      push: async () => ({
        accepted: [],
        conflicts: [],
        new_version: 2,
        conversation_id_mappings: {},
      }),
      getStatus: async () => ({
        last_synced_at: new Date(1_700_000_000_000).toISOString(),
        sync_version: 2,
        pending_changes: 0,
      }),
      connectRealtime: () => () => {},
    };
    const manager = new SyncManager({ storage: createStorage(), syncClient });
    const firstSync = manager.sync();
    await Promise.resolve();

    const start = performance.now();
    await manager.sync();
    const elapsed = performance.now() - start;

    firstPull.resolve(emptyPullResponse(1));
    await firstSync;
    manager.destroy();
    return elapsed;
  } finally {
    console.info = originalInfo;
    console.log = originalLog;
  }
};

const client = createClient();

await runLatencyBenchmarkSuite('sync-client P1', [
  {
    name: 'request-attempt-status',
    run: async () => {
      await client.getStatus();
    },
  },
  {
    name: 'pull',
    run: async () => {
      await client.pull(0, 'device-1');
    },
  },
  {
    name: 'push',
    run: async () => {
      await client.push([], [], [], 'device-1');
    },
  },
  {
    name: 'realtime-token-fetch',
    sample: async () => {
      const metrics = await waitForRealtimeEvent();
      return metrics.lastTimer('sync.client.realtime.token.duration');
    },
  },
  {
    name: 'realtime-poll',
    sample: async () => {
      const metrics = await waitForRealtimeEvent();
      return metrics.lastTimer('sync.client.realtime.poll.duration');
    },
  },
  {
    name: 'queued-sync',
    sample: sampleQueuedSync,
  },
]);
