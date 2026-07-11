import { act, waitFor } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  readDesktopWorkState,
  useDesktopWorkStateQuery,
  useSendDesktopTurnMutation,
  useStartDesktopThreadMutation,
} from '../../../hooks/api/desktopWork';
import { renderHookWithQueryClient } from '../../helpers/query-client';

const mockCallDesktopAppServerRpc = jest.fn();
const mockPingDesktopAppServer = jest.fn();
const mockReadDesktopPairingSession = jest.fn();

jest.mock('../../../desktop-pairing/client', () => ({
  callDesktopAppServerRpc: (...args: unknown[]) => mockCallDesktopAppServerRpc(...args),
  pingDesktopAppServer: (...args: unknown[]) => mockPingDesktopAppServer(...args),
  DesktopPairingError: class DesktopPairingError extends Error {},
}));

jest.mock('../../../desktop-pairing/session-store', () => ({
  readDesktopPairingSession: () => mockReadDesktopPairingSession(),
}));

jest.mock('../../../logger', () => ({
  mobileLogger: {
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

const pairedSession = {
  baseUrl: 'http://127.0.0.1:4317',
  rpcPath: '/rpc',
  sessionToken: 'pair-token',
  transport: 'http' as const,
};

const thread = {
  sessionId: 'thread-1',
  title: 'Existing thread',
  objective: 'Ship it',
  state: 'running',
  source: 'desktop',
  createdAt: 1,
  updatedAt: 2,
};

describe('desktop work API hooks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPingDesktopAppServer.mockResolvedValue(undefined);
    mockCallDesktopAppServerRpc.mockImplementation(async (_session, method: string) => {
      switch (method) {
        case 'project.list':
          return { projects: [{ id: 7, name: 'Mobile' }], activeProjectId: 7 };
        case 'thread.list':
          return { threads: [thread] };
        case 'pendingChange.list':
          return { pendingChanges: [{ type: 'message', entityId: 'm1', operation: 'create', data: {}, createdAt: 3 }] };
        case 'turn.start':
        case 'thread.start':
          return { thread };
        default:
          return {};
      }
    });
  });

  it('returns an unpaired state without touching the desktop app-server', async () => {
    mockReadDesktopPairingSession.mockResolvedValueOnce(null);

    await expect(readDesktopWorkState()).resolves.toEqual({
      status: 'unpaired',
      projects: [],
      threads: [],
      pendingChanges: [],
      activeProjectId: null,
      machineName: null,
      message: 'Pair this phone with the desktop app to view live work.',
    });
    expect(mockPingDesktopAppServer).not.toHaveBeenCalled();
  });

  it('loads connected desktop work state and normalizes localhost machine names', async () => {
    const fetchImpl = jest.fn() as unknown as typeof fetch;
    mockReadDesktopPairingSession.mockResolvedValueOnce(pairedSession);

    const state = await readDesktopWorkState(fetchImpl);

    expect(state).toEqual({
      status: 'connected',
      projects: [{ id: 7, name: 'Mobile' }],
      threads: [thread],
      pendingChanges: [{ type: 'message', entityId: 'm1', operation: 'create', data: {}, createdAt: 3 }],
      activeProjectId: 7,
      machineName: 'This Mac',
      connection: {
        baseUrl: 'http://127.0.0.1:4317',
        rpcPath: '/rpc',
        transport: 'http',
      },
    });
    expect(mockPingDesktopAppServer).toHaveBeenCalledWith(pairedSession, fetchImpl);
    expect(mockCallDesktopAppServerRpc).toHaveBeenCalledWith(pairedSession, 'thread.list', {}, fetchImpl);
  });

  it('falls back when desktop project metadata is unavailable', async () => {
    mockReadDesktopPairingSession.mockResolvedValueOnce({
      ...pairedSession,
      baseUrl: 'https://desktop.example',
    });
    mockCallDesktopAppServerRpc.mockImplementation(async (_session, method: string) => {
      if (method === 'project.list') {
        throw new Error('not supported');
      }
      if (method === 'thread.list') {
        return { threads: [] };
      }
      return { pendingChanges: [] };
    });

    const state = await readDesktopWorkState();

    expect(state.status).toBe('connected');
    if (state.status === 'connected') {
      expect(state.projects).toEqual([]);
      expect(state.activeProjectId).toBeNull();
      expect(state.machineName).toBe('desktop.example');
    }
  });

  it('uses React Query enablement for desktop state polling', async () => {
    mockReadDesktopPairingSession.mockResolvedValue(pairedSession);

    const disabled = await renderHookWithQueryClient(() => useDesktopWorkStateQuery(false));
    expect(disabled.result.current.fetchStatus).toBe('idle');
    expect(mockReadDesktopPairingSession).not.toHaveBeenCalled();

    const enabled = await renderHookWithQueryClient(() => useDesktopWorkStateQuery(true));
    await waitFor(() => expect(enabled.result.current.data?.status).toBe('connected'));
  });

  it('sends desktop turns and invalidates desktop work state', async () => {
    mockReadDesktopPairingSession.mockResolvedValueOnce(pairedSession);
    const { result, queryClient } = await renderHookWithQueryClient(() => useSendDesktopTurnMutation());
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync({ threadId: 'thread-1', input: 'continue' });
    });

    expect(mockCallDesktopAppServerRpc).toHaveBeenCalledWith(pairedSession, 'turn.start', {
      threadId: 'thread-1',
      input: 'continue',
      quickMode: true,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['desktopWork'] });
  });

  it('starts desktop threads with a concise title and reports unpaired errors', async () => {
    mockReadDesktopPairingSession.mockResolvedValueOnce(pairedSession);
    const { result } = await renderHookWithQueryClient(() => useStartDesktopThreadMutation());

    await act(async () => {
      await result.current.mutateAsync({
        input: '  summarize the quarterly planning notes into action items now please  ',
      });
    });

    expect(mockCallDesktopAppServerRpc).toHaveBeenCalledWith(pairedSession, 'thread.start', {
      objective: '  summarize the quarterly planning notes into action items now please  ',
      title: 'summarize the quarterly planning notes into action',
      source: 'mobile',
    });

    mockReadDesktopPairingSession.mockResolvedValueOnce(null);
    const unpaired = await renderHookWithQueryClient(() => useStartDesktopThreadMutation());
    await expect(unpaired.result.current.mutateAsync({ input: '' })).rejects.toThrow(
      'Pair this phone with the desktop app first.'
    );
  });
});
