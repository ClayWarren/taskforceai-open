import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';

const storedSession = {
  baseUrl: 'http://127.0.0.1:7319',
  rpcPath: '/rpc',
  sessionToken: 'session-token',
  transport: { kind: 'http', encoding: 'json' },
};

let currentSession: typeof storedSession | null = storedSession;
const loggerState = {
  debugCalls: [] as unknown[],
  errorCalls: [] as unknown[],
};

mock.module('../../features/desktop-work/pairing/session-store', () => ({
  readDesktopPairingHosts: mock(async () => []),
  readDesktopPairingSession: mock(async () => currentSession),
  selectDesktopPairingHost: mock(async () => currentSession),
}));

mock.module('../../logger', () => ({
  createModuleLogger: () => ({
    debug: mock((...args: unknown[]) => {
      loggerState.debugCalls.push(args);
    }),
    error: mock((...args: unknown[]) => {
      loggerState.errorCalls.push(args);
    }),
    warn: mock(() => {}),
  }),
  mobileLogger: {
    debug: mock((...args: unknown[]) => {
      loggerState.debugCalls.push(args);
    }),
    error: mock((...args: unknown[]) => {
      loggerState.errorCalls.push(args);
    }),
  },
}));

const {
  readDesktopWorkState,
  useDesktopWorkStateQuery,
  useSendDesktopTurnMutation,
  useStartDesktopThreadMutation,
} = await import('../../features/desktop-work/data/desktop-work');

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const createQueryHarness = async <T>(useHook: () => T) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const invalidations: unknown[] = [];
  queryClient.invalidateQueries = mock(async (filters?: unknown) => {
    invalidations.push(filters);
    return undefined;
  }) as typeof queryClient.invalidateQueries;
  const rendered = await renderHook(useHook, {
    wrapper: ({ children }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children),
  });
  return { ...rendered, queryClient, invalidations };
};

describe('desktop work query data', () => {
  beforeEach(() => {
    currentSession = storedSession;
    loggerState.debugCalls = [];
    loggerState.errorCalls = [];
  });

  it('returns the unpaired state without pinging the desktop app-server', async () => {
    currentSession = null;
    const fetchMock = mock(async () => {
      throw new Error('fetch should not be called');
    });

    await expect(readDesktopWorkState(fetchMock as typeof fetch)).resolves.toEqual({
      status: 'unpaired',
      projects: [],
      threads: [],
      pendingChanges: [],
      interactions: [],
      activeProjectId: null,
      machineName: null,
      message: 'Pair this phone with the desktop app to view live work.',
    });
  });

  it('does not expose the desktop session token in connected query data', async () => {
    const fetchMock = mock(async (url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        Authorization: 'Bearer session-token',
      });
      if (url.endsWith('/events/snapshot')) {
        return jsonResponse({ events: [] });
      }
      const method = JSON.parse(init?.body as string).method;
      switch (method) {
        case 'server.ping':
          return jsonResponse({ result: { ok: true } });
        case 'project.list':
          return jsonResponse({ result: { projects: [], activeProjectId: null } });
        case 'thread.list':
          return jsonResponse({ result: { threads: [] } });
        case 'pendingChange.list':
          return jsonResponse({ result: { pendingChanges: [] } });
        default:
          throw new Error(`unexpected method ${method}`);
      }
    });

    const result = await readDesktopWorkState(fetchMock as typeof fetch);

    expect(result.status).toBe('connected');
    if (result.status === 'connected') {
      expect(result.connection).toEqual({
        baseUrl: storedSession.baseUrl,
        rpcPath: storedSession.rpcPath,
        transport: storedSession.transport,
      });
    }
    expect(JSON.stringify(result)).not.toContain('session-token');
  });

  it('normalizes desktop threads without ES2023 array methods or mutating API data', async () => {
    const turns = [
      {
        id: 'turn-1',
        threadId: 'thread-1',
        runId: 'run-1',
        status: 'completed',
        items: [
          {
            id: 'item-1',
            turnId: 'turn-1',
            type: 'agentMessage',
            status: 'completed',
            content: 'older response',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'turn-2',
        threadId: 'thread-1',
        runId: 'run-2',
        status: 'queued',
        items: [
          {
            id: 'item-2',
            turnId: 'turn-2',
            type: 'agentMessage',
            status: 'completed',
            content: 'latest response',
            createdAt: 2,
            updatedAt: 2,
          },
        ],
        createdAt: 2,
        updatedAt: 2,
      },
    ];
    const originalTurns = structuredClone(turns);
    const fetchMock = mock(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/events/snapshot')) return jsonResponse({ events: [] });
      const method = JSON.parse(init?.body as string).method;
      switch (method) {
        case 'server.ping':
          return jsonResponse({ result: { ok: true } });
        case 'project.list':
          return jsonResponse({ result: { projects: [], activeProjectId: null } });
        case 'thread.list':
          return jsonResponse({
            result: {
              threads: [{ sessionId: 'thread-1', title: 'Compatibility', turns }],
            },
          });
        case 'pendingChange.list':
          return jsonResponse({ result: { pendingChanges: [] } });
        default:
          throw new Error(`unexpected method ${method}`);
      }
    });

    const result = await readDesktopWorkState(fetchMock as typeof fetch);

    expect(result).toMatchObject({
      status: 'connected',
      threads: [
        {
          activeRunId: 'run-2',
          lastMessage: 'latest response',
        },
      ],
    });
    expect(turns).toEqual(originalTurns);
  });

  it('falls back when desktop project metadata is unavailable', async () => {
    currentSession = {
      ...storedSession,
      baseUrl: 'http://clay-mac.local:7319',
    };
    const fetchMock = mock(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/events/snapshot')) {
        return jsonResponse({ events: [] });
      }
      const method = JSON.parse(init?.body as string).method;
      switch (method) {
        case 'server.ping':
          return jsonResponse({ result: { ok: true } });
        case 'project.list':
          return jsonResponse({ error: { code: -32000, message: 'project store unavailable' } });
        case 'thread.list':
          return jsonResponse({
            result: {
              threads: [
                {
                  sessionId: 'thread-1',
                  title: 'Investigate',
                  objective: 'Check mobile app state',
                  state: 'running',
                  source: 'mobile',
                  createdAt: 1,
                  updatedAt: 2,
                },
              ],
            },
          });
        case 'pendingChange.list':
          return jsonResponse({
            result: {
              pendingChanges: [
                {
                  id: 1,
                  type: 'conversation',
                  entityId: 'conv-1',
                  operation: 'update',
                  data: { title: 'Updated' },
                  createdAt: 3,
                },
              ],
            },
          });
        default:
          throw new Error(`unexpected method ${method}`);
      }
    });

    const result = await readDesktopWorkState(fetchMock as typeof fetch);

    expect(result).toMatchObject({
      status: 'connected',
      projects: [],
      activeProjectId: null,
      machineName: 'clay-mac.local',
    });
    if (result.status === 'connected') {
      expect(result.threads).toHaveLength(1);
      expect(result.pendingChanges).toHaveLength(1);
    }
    expect(loggerState.debugCalls[0]).toEqual(
      expect.arrayContaining(['[readDesktopWorkState] Desktop project metadata unavailable'])
    );
  });

  it('reads desktop work through the React Query hook when enabled', async () => {
    currentSession = null;
    const { result } = await createQueryHarness(() => useDesktopWorkStateQuery(true));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toMatchObject({
      status: 'unpaired',
      message: 'Pair this phone with the desktop app to view live work.',
    });
  });

  it('sends desktop turns and invalidates desktop work state', async () => {
    const rpcRequests: unknown[] = [];
    const fetchMock = mock(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      rpcRequests.push(body);
      return jsonResponse({
        result: {
          thread: {
            sessionId: 'thread-1',
            title: 'Existing thread',
            objective: 'Keep going',
            state: 'running',
            source: 'mobile',
            createdAt: 1,
            updatedAt: 2,
          },
        },
      });
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      const { result, invalidations } = await createQueryHarness(() => useSendDesktopTurnMutation());

      await act(async () => {
        await result.current.mutateAsync({ threadId: 'thread-1', input: 'Continue the work' });
      });

      expect(rpcRequests).toEqual([
        expect.objectContaining({
          method: 'turn.start',
          params: {
            threadId: 'thread-1',
            input: 'Continue the work',
            quickMode: true,
            attachmentIds: [],
          },
        }),
      ]);
      expect(invalidations).toEqual([{ queryKey: ['desktopWork'] }]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('rejects desktop turns while unpaired', async () => {
    currentSession = null;
    const { result } = await createQueryHarness(() => useSendDesktopTurnMutation());

    await act(async () => {
      await expect(
        result.current.mutateAsync({ threadId: 'thread-1', input: 'Continue the work' })
      ).rejects.toThrow('Pair this phone with the desktop app first.');
    });

    expect(loggerState.errorCalls).toEqual([
      expect.arrayContaining(['[useSendDesktopTurnMutation] Failed to send desktop turn']),
    ]);
  });

  it('logs non-error desktop turn failures', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => {
      throw 'offline';
    }) as typeof fetch;

    try {
      const { result } = await createQueryHarness(() => useSendDesktopTurnMutation());

      await act(async () => {
        await expect(
          result.current.mutateAsync({ threadId: 'thread-1', input: 'Continue the work' })
        ).rejects.toBe('offline');
      });

      expect(loggerState.errorCalls).toEqual([
        [
          '[useSendDesktopTurnMutation] Failed to send desktop turn',
          {
            error: 'offline',
          },
        ],
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('starts desktop threads with a title derived from the objective', async () => {
    const rpcRequests: unknown[] = [];
    const fetchMock = mock(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      rpcRequests.push(body);
      if (body.method === 'project.clear') return jsonResponse({ result: {} });
      return jsonResponse({
        result: {
          thread: {
            sessionId: 'thread-2',
            title: 'one two three four five six seven',
            objective: body.params.objective ?? 'one two three four five six seven eight nine',
            state: 'running',
            source: 'mobile',
            createdAt: 1,
            updatedAt: 2,
          },
        },
      });
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      const { result, invalidations } = await createQueryHarness(() => useStartDesktopThreadMutation());

      await act(async () => {
        await result.current.mutateAsync({
          input: 'one two three four five six seven eight nine',
        });
      });

      expect(rpcRequests).toEqual([
        expect.objectContaining({
          method: 'project.clear',
          params: {},
        }),
        expect.objectContaining({
          method: 'thread.start',
          params: {
            objective: 'one two three four five six seven eight nine',
            title: 'one two three four five six seven',
            source: 'mobile',
            taskMode: 'code',
          },
        }),
        expect.objectContaining({
          method: 'turn.start',
          params: {
            threadId: 'thread-2',
            input: 'one two three four five six seven eight nine',
            quickMode: false,
            autonomous: false,
            attachmentIds: [],
          },
        }),
      ]);
      expect(invalidations).toEqual([{ queryKey: ['desktopWork'] }]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('rejects desktop mutations while unpaired', async () => {
    currentSession = null;
    const { result } = await createQueryHarness(() => useStartDesktopThreadMutation());

    await act(async () => {
      await expect(result.current.mutateAsync({ input: 'start work' })).rejects.toThrow(
        'Pair this phone with the desktop app first.'
      );
    });
  });
});
