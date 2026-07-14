import { act, waitFor } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  readDesktopWorkState,
  useDesktopWorkStateQuery,
  useDesktopThreadQuery,
  useDesktopReviewQuery,
  useDesktopGitStatusQuery,
  useDesktopWorkspaceFilesQuery,
  useDesktopWorkspaceFileQuery,
  useDesktopThreadActionMutation,
  useInterruptDesktopTurnMutation,
  useRenameDesktopThreadMutation,
  useRespondDesktopInteractionMutation,
  useSendDesktopTurnMutation,
  useStartDesktopThreadMutation,
  threadItemImageUri,
  threadItemText,
} from '../../../features/desktop-work/data/desktop-work';
import { renderHookWithQueryClient } from '../../helpers/query-client';

const mockCallDesktopAppServerRpc = jest.fn();
const mockListDesktopAppServerEvents = jest.fn();
const mockReadDesktopPairingSession = jest.fn();
const mockRespondToDesktopAppServerRequest = jest.fn();

jest.mock('../../../features/desktop-work/pairing/client', () => ({
  callDesktopAppServerRpc: (...args: unknown[]) => mockCallDesktopAppServerRpc(...args),
  listDesktopAppServerEvents: (...args: unknown[]) => mockListDesktopAppServerEvents(...args),
  respondToDesktopAppServerRequest: (...args: unknown[]) =>
    mockRespondToDesktopAppServerRequest(...args),
  DesktopPairingError: class DesktopPairingError extends Error {},
}));

jest.mock('../../../features/desktop-work/pairing/session-store', () => ({
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
    mockListDesktopAppServerEvents.mockResolvedValue([]);
    mockRespondToDesktopAppServerRequest.mockResolvedValue(undefined);
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
      interactions: [],
      activeProjectId: null,
      machineName: null,
      message: 'Pair this phone with the desktop app to view live work.',
    });
  });

  it('loads connected desktop work state and normalizes localhost machine names', async () => {
    const fetchImpl = jest.fn() as unknown as typeof fetch;
    mockReadDesktopPairingSession.mockResolvedValueOnce(pairedSession);

    const state = await readDesktopWorkState(fetchImpl);

    expect(state).toEqual({
      status: 'connected',
      projects: [{ id: 7, name: 'Mobile' }],
      threads: [expect.objectContaining(thread)],
      pendingChanges: [{ type: 'message', entityId: 'm1', operation: 'create', data: {}, createdAt: 3 }],
      interactions: [],
      activeProjectId: 7,
      machineName: 'This Mac',
      connection: {
        baseUrl: 'http://127.0.0.1:4317',
        rpcPath: '/rpc',
        transport: 'http',
      },
    });
    expect(mockCallDesktopAppServerRpc).toHaveBeenCalledWith(pairedSession, 'thread.list', {}, fetchImpl);
  });

  it('returns unresolved desktop approval requests and filters resolved ones', async () => {
    mockReadDesktopPairingSession.mockResolvedValueOnce(pairedSession);
    mockListDesktopAppServerEvents.mockResolvedValueOnce([
      {
        jsonrpc: '2.0',
        id: 10,
        method: 'item/permissions/requestApproval',
        params: { threadId: 'thread-1', reason: 'Run checks' },
      },
      {
        jsonrpc: '2.0',
        id: 11,
        method: 'item/fileChange/requestApproval',
        params: { threadId: 'thread-1' },
      },
      {
        jsonrpc: '2.0',
        method: 'serverRequest/resolved',
        params: { threadId: 'thread-1', requestId: 11 },
      },
    ]);

    const state = await readDesktopWorkState();
    expect(state.status).toBe('connected');
    if (state.status === 'connected') {
      expect(state.interactions).toEqual([
        {
          id: 10,
          method: 'item/permissions/requestApproval',
          threadId: 'thread-1',
          params: { threadId: 'thread-1', reason: 'Run checks' },
        },
      ]);
    }
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
      modelId: undefined,
      reasoningEffort: undefined,
      attachmentIds: [],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['desktopWork'] });
  });

  it('sends the selected model, effort, and mobile attachment IDs to a queued Remote turn', async () => {
    mockReadDesktopPairingSession.mockResolvedValueOnce(pairedSession);
    const { result } = await renderHookWithQueryClient(() => useSendDesktopTurnMutation());
    await act(async () => {
      await result.current.mutateAsync({
        threadId: 'thread-1',
        input: 'review the screenshot',
        modelId: 'openai/gpt-5.6-sol',
        reasoningEffort: 'high',
        attachmentIds: ['attachment-1'],
      });
    });
    expect(mockCallDesktopAppServerRpc).toHaveBeenCalledWith(pairedSession, 'turn.start', {
      threadId: 'thread-1',
      input: 'review the screenshot',
      quickMode: true,
      modelId: 'openai/gpt-5.6-sol',
      reasoningEffort: 'high',
      attachmentIds: ['attachment-1'],
    });
  });

  it('steers an active Remote turn separately from queueing a follow-up', async () => {
    mockReadDesktopPairingSession.mockResolvedValueOnce(pairedSession);
    const { result } = await renderHookWithQueryClient(() => useSendDesktopTurnMutation());
    await act(async () => {
      await result.current.mutateAsync({
        threadId: 'thread-1',
        input: 'focus on the failing test',
        behavior: 'steer',
      });
    });
    expect(mockCallDesktopAppServerRpc).toHaveBeenCalledWith(pairedSession, 'turn.steer', {
      threadId: 'thread-1',
      input: 'focus on the failing test',
    });
  });

  it('reads canonical thread activity, review scopes, workspace files, and file previews', async () => {
    mockReadDesktopPairingSession.mockResolvedValue(pairedSession);
    mockCallDesktopAppServerRpc.mockImplementation(async (_session, method: string) => {
      if (method === 'thread.read') {
        return {
          thread: {
            id: 'thread-1',
            title: 'Remote activity',
            objective: 'Inspect the result',
            state: 'active',
            taskMode: 'code',
            archived: false,
            source: 'mobile',
            turns: [],
            createdAt: 1,
            updatedAt: 2,
          },
        };
      }
      if (method === 'git.review.diff') return { files: [], rawDiff: '', scope: 'staged' };
      if (method === 'git.review.status') return { branch: 'codex/mobile', files: [] };
      if (method === 'workspace.file.list') return { files: ['src/main.ts'], truncated: false };
      if (method === 'workspace.file.read') return { path: 'src/main.ts', content: 'export {};', binary: false, truncated: false };
      return {};
    });

    const threadHook = await renderHookWithQueryClient(() => useDesktopThreadQuery('thread-1', true));
    await waitFor(() => expect(threadHook.result.current.data?.id).toBe('thread-1'));
    const reviewHook = await renderHookWithQueryClient(() => useDesktopReviewQuery('staged', true));
    await waitFor(() => expect(reviewHook.result.current.data?.scope).toBe('staged'));
    const gitHook = await renderHookWithQueryClient(() =>
      useDesktopGitStatusQuery('/workspace/taskforceai', true)
    );
    await waitFor(() => expect(gitHook.result.current.data?.branch).toBe('codex/mobile'));
    const filesHook = await renderHookWithQueryClient(() => useDesktopWorkspaceFilesQuery('main', true));
    await waitFor(() => expect(filesHook.result.current.data?.files).toEqual(['src/main.ts']));
    const fileHook = await renderHookWithQueryClient(() => useDesktopWorkspaceFileQuery('src/main.ts', true));
    await waitFor(() => expect(fileHook.result.current.data?.content).toBe('export {};'));
  });

  it('executes Remote lifecycle, rename, and stop actions through scoped RPCs', async () => {
    mockReadDesktopPairingSession.mockResolvedValue(pairedSession);
    const action = await renderHookWithQueryClient(() => useDesktopThreadActionMutation());
    const rename = await renderHookWithQueryClient(() => useRenameDesktopThreadMutation());
    const interrupt = await renderHookWithQueryClient(() => useInterruptDesktopTurnMutation());
    await act(async () => {
      await action.result.current.mutateAsync({ threadId: 'thread-1', action: 'archive' });
      await rename.result.current.mutateAsync({ threadId: 'thread-1', title: 'Renamed Remote task' });
      await interrupt.result.current.mutateAsync({ threadId: 'thread-1' });
    });
    expect(mockCallDesktopAppServerRpc).toHaveBeenCalledWith(pairedSession, 'thread.archive', { threadId: 'thread-1' });
    expect(mockCallDesktopAppServerRpc).toHaveBeenCalledWith(pairedSession, 'thread.name.set', {
      threadId: 'thread-1',
      title: 'Renamed Remote task',
    });
    expect(mockCallDesktopAppServerRpc).toHaveBeenCalledWith(pairedSession, 'turn.interrupt', { threadId: 'thread-1' });
  });

  it('responds to desktop interactions and invalidates desktop work', async () => {
    mockReadDesktopPairingSession.mockResolvedValue(pairedSession);
    const { result, queryClient } = await renderHookWithQueryClient(() =>
      useRespondDesktopInteractionMutation()
    );
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync({ requestId: 7, decision: 'acceptForSession' });
      await result.current.mutateAsync({ requestId: 'request-8', response: { answers: ['yes'] } });
    });

    expect(mockRespondToDesktopAppServerRequest).toHaveBeenNthCalledWith(
      1,
      pairedSession,
      7,
      { decision: 'acceptForSession' }
    );
    expect(mockRespondToDesktopAppServerRequest).toHaveBeenNthCalledWith(
      2,
      pairedSession,
      'request-8',
      { answers: ['yes'] }
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['desktopWork'] });
  });

  it('reports unpaired and failed desktop interaction responses', async () => {
    mockReadDesktopPairingSession.mockResolvedValueOnce(null);
    const unpaired = await renderHookWithQueryClient(() => useRespondDesktopInteractionMutation());
    await expect(unpaired.result.current.mutateAsync({ requestId: 7 })).rejects.toThrow(
      'Pair this phone with the desktop app first.'
    );

    mockReadDesktopPairingSession.mockResolvedValueOnce(pairedSession);
    mockRespondToDesktopAppServerRequest.mockRejectedValueOnce('response offline');
    const failed = await renderHookWithQueryClient(() => useRespondDesktopInteractionMutation());
    await expect(failed.result.current.mutateAsync({ requestId: 8 })).rejects.toBe(
      'response offline'
    );
  });

  it('logs desktop action failures and reads structured thread item text', async () => {
    mockReadDesktopPairingSession.mockResolvedValue(pairedSession);
    mockCallDesktopAppServerRpc.mockRejectedValueOnce(new Error('archive failed'));
    const action = await renderHookWithQueryClient(() => useDesktopThreadActionMutation());

    await expect(
      action.result.current.mutateAsync({ threadId: 'thread-1', action: 'archive' })
    ).rejects.toThrow('archive failed');
    expect(threadItemText({ content: { message: 'structured text' } } as never)).toBe(
      'structured text'
    );
    expect(
      threadItemText({
        content: { toolName: 'computer_use', arguments: { action: 'click' } },
      } as never)
    ).toContain('computer_use');
    expect(
      threadItemImageUri({ content: { image_base64: 'abc123' } } as never)
    ).toBe('data:image/png;base64,abc123');
    expect(threadItemText({ content: { toolName: 'computer_use' } } as never)).toBe(
      'computer_use'
    );
    expect(
      threadItemText({ content: { toolName: 'counter', arguments: BigInt(7) } } as never)
    ).toBe('counter\n7');
    expect(
      threadItemText({ content: { toolName: 'marker', arguments: Symbol('ready') } } as never)
    ).toBe('marker\nSymbol(ready)');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(threadItemText({ content: circular } as never)).toBe(
      '[unserializable desktop item]'
    );
  });

  it('starts desktop threads with a concise title and reports unpaired errors', async () => {
    mockReadDesktopPairingSession.mockResolvedValueOnce(pairedSession);
    const { result } = await renderHookWithQueryClient(() => useStartDesktopThreadMutation());

    await act(async () => {
      await result.current.mutateAsync({
        input: '  summarize the quarterly planning notes into action items now please  ',
      });
    });

    expect(mockCallDesktopAppServerRpc.mock.calls).toEqual([
      [pairedSession, 'project.clear', {}],
      [pairedSession, 'thread.start', {
        objective: '  summarize the quarterly planning notes into action items now please  ',
        title: 'summarize the quarterly planning notes into action',
        source: 'mobile',
        taskMode: 'code',
      }],
      [pairedSession, 'turn.start', {
        threadId: 'thread-1',
        input: '  summarize the quarterly planning notes into action items now please  ',
        quickMode: false,
        autonomous: false,
        modelId: undefined,
        reasoningEffort: undefined,
        projectId: undefined,
        attachmentIds: [],
      }],
    ]);

    mockReadDesktopPairingSession.mockResolvedValueOnce(null);
    const unpaired = await renderHookWithQueryClient(() => useStartDesktopThreadMutation());
    await expect(unpaired.result.current.mutateAsync({ input: '' })).rejects.toThrow(
      'Pair this phone with the desktop app first.'
    );
  });

  it('deletes a partially-created thread when its initial turn fails', async () => {
    mockReadDesktopPairingSession.mockResolvedValueOnce(pairedSession);
    mockCallDesktopAppServerRpc.mockImplementation(async (_session, method: string) => {
      if (method === 'thread.start') return { thread };
      if (method === 'turn.start') throw new Error('turn failed');
      if (method === 'thread.delete') throw new Error('cleanup failed');
      return {};
    });
    const { result } = await renderHookWithQueryClient(() => useStartDesktopThreadMutation());

    await expect(result.current.mutateAsync({ input: 'Start work' })).rejects.toThrow('turn failed');
    expect(mockCallDesktopAppServerRpc).toHaveBeenCalledWith(pairedSession, 'thread.delete', {
      threadId: 'thread-1',
    });
  });
});
