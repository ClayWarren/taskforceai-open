import { beforeEach, describe, expect, it, mock } from 'bun:test';

const storedSession = {
  baseUrl: 'http://127.0.0.1:7319',
  rpcPath: '/rpc',
  sessionToken: 'session-token',
  transport: { kind: 'http', encoding: 'json' },
};

let currentSession: typeof storedSession | null = storedSession;
const loggerState = {
  debugCalls: [] as unknown[],
};

mock.module('../../desktop-pairing/session-store', () => ({
  readDesktopPairingSession: mock(async () => currentSession),
}));

mock.module('../../logger', () => ({
  mobileLogger: {
    debug: mock((...args: unknown[]) => {
      loggerState.debugCalls.push(args);
    }),
    error: mock(() => {}),
  },
}));

const { readDesktopWorkState } = await import('../../hooks/api/desktopWork');

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

describe('desktop work query data', () => {
  beforeEach(() => {
    currentSession = storedSession;
    loggerState.debugCalls = [];
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
      activeProjectId: null,
      machineName: null,
      message: 'Pair this phone with the desktop app to view live work.',
    });
  });

  it('does not expose the desktop session token in connected query data', async () => {
    const fetchMock = mock(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        Authorization: 'Bearer session-token',
      });
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

  it('falls back when desktop project metadata is unavailable', async () => {
    currentSession = {
      ...storedSession,
      baseUrl: 'http://clay-mac.local:7319',
    };
    const fetchMock = mock(async (_url: string, init?: RequestInit) => {
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
});
