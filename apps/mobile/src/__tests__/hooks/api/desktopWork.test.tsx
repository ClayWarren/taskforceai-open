import { act, waitFor } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  readAllDesktopWorkStates,
  readDesktopWorkState,
  useAllDesktopWorkStatesQuery,
  useAttachDesktopWorkspaceMutation,
  useCloneDesktopProjectMutation,
  useCreateDesktopProjectMutation,
  useDesktopWorkStateQuery,
  useDesktopThreadQuery,
  useDesktopReviewQuery,
  useDesktopReviewActionMutation,
  useDesktopGitBranchesQuery,
  useDesktopGitFinishMutation,
  useDesktopGitHubRepositoriesQuery,
  useDesktopGitStatusQuery,
  useDesktopGitWorktreesQuery,
  useDesktopHostsQuery,
  useDesktopSkillsQuery,
  useDesktopWorkspaceFilesQuery,
  useDesktopWorkspaceFileQuery,
  useCreateDesktopWorktreeMutation,
  useDesktopThreadActionMutation,
  useInterruptDesktopTurnMutation,
  useRenameDesktopThreadMutation,
  useRespondDesktopInteractionMutation,
  useSelectDesktopHostMutation,
  useSendDesktopTurnMutation,
  useStartDesktopThreadMutation,
  threadItemImageUri,
  threadItemText,
} from '../../../features/desktop-work/data/desktop-work';
import { renderHookWithQueryClient } from '../../helpers/query-client';

const mockCallDesktopAppServerRpc = jest.fn();
const mockListDesktopAppServerEvents = jest.fn();
const mockReadDesktopPairingHosts = jest.fn();
const mockReadDesktopPairingSession = jest.fn();
const mockRespondToDesktopAppServerRequest = jest.fn();
const mockSelectDesktopPairingHost = jest.fn();

jest.mock('../../../features/desktop-work/pairing/client', () => ({
  callDesktopAppServerRpc: (...args: unknown[]) => mockCallDesktopAppServerRpc(...args),
  listDesktopAppServerEvents: (...args: unknown[]) => mockListDesktopAppServerEvents(...args),
  respondToDesktopAppServerRequest: (...args: unknown[]) =>
    mockRespondToDesktopAppServerRequest(...args),
  DesktopPairingError: class DesktopPairingError extends Error {},
}));

jest.mock('../../../features/desktop-work/pairing/session-store', () => ({
  readDesktopPairingHosts: () => mockReadDesktopPairingHosts(),
  readDesktopPairingSession: () => mockReadDesktopPairingSession(),
  selectDesktopPairingHost: (hostId: string) => mockSelectDesktopPairingHost(hostId),
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
    mockReadDesktopPairingHosts.mockResolvedValue([]);
    mockRespondToDesktopAppServerRequest.mockResolvedValue(undefined);
    mockSelectDesktopPairingHost.mockResolvedValue(pairedSession);
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
      projects: [{ id: 7, name: 'Mobile', hostId: 'http://127.0.0.1:4317', machineName: 'This Mac' }],
      threads: [expect.objectContaining(thread)],
      pendingChanges: [{ type: 'message', entityId: 'm1', operation: 'create', data: {}, createdAt: 3 }],
      interactions: [],
      activeProjectId: 7,
      machineName: 'This Mac',
      connection: {
        baseUrl: 'http://127.0.0.1:4317',
        rpcPath: '/rpc',
        transport: 'http',
        controllerDeviceId: undefined,
        targetDeviceId: undefined,
        machineName: undefined,
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

  it('rejects an explicit thread refetch when no thread is selected', async () => {
    const query = await renderHookWithQueryClient(() => useDesktopThreadQuery(null, true));
    await act(async () => {
      await expect(query.result.current.refetch()).resolves.toMatchObject({
        error: expect.objectContaining({ message: 'Select a desktop thread first.' }),
      });
    });
  });

  it('loads every reachable desktop host and exposes host polling', async () => {
    const secondSession = { ...pairedSession, baseUrl: 'https://second.example' };
    mockReadDesktopPairingHosts.mockResolvedValue([
      { id: 'first', name: 'First', session: pairedSession, lastConnectedAt: 2 },
      { id: 'second', name: 'Second', session: secondSession, lastConnectedAt: 1 },
    ]);
    mockCallDesktopAppServerRpc.mockImplementation(async (session, method: string) => {
      if (session === secondSession && method === 'thread.list') throw new Error('offline');
      if (method === 'project.list') return { projects: [], activeProjectId: null };
      if (method === 'thread.list') return { threads: [] };
      if (method === 'pendingChange.list') return { pendingChanges: [] };
      return {};
    });

    await expect(readAllDesktopWorkStates()).resolves.toEqual([
      expect.objectContaining({ status: 'connected', machineName: 'This Mac' }),
    ]);

    const hosts = await renderHookWithQueryClient(() => useDesktopHostsQuery(true));
    await waitFor(() => expect(hosts.result.current.data).toHaveLength(2));
    const environments = await renderHookWithQueryClient(() => useAllDesktopWorkStatesQuery(true));
    await waitFor(() => expect(environments.result.current.data).toHaveLength(1));
  });

  it('falls back to the active session when no saved desktop hosts exist', async () => {
    mockReadDesktopPairingSession.mockResolvedValueOnce(null);
    await expect(readAllDesktopWorkStates()).resolves.toEqual([]);
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

  it('sends Plan turns read-only and discovers enabled desktop skills', async () => {
    mockReadDesktopPairingSession.mockResolvedValue(pairedSession);
    mockCallDesktopAppServerRpc.mockImplementation(async (_session, method: string) => {
      if (method === 'skill.list') {
        return {
          skills: [
            {
              name: 'security-scan',
              description: 'Audit the workspace',
              path: '/skills/security-scan',
              source: 'user',
              enabled: true,
            },
          ],
          truncated: false,
        };
      }
      return { thread };
    });
    const turn = await renderHookWithQueryClient(() => useSendDesktopTurnMutation());
    await act(async () => {
      await turn.result.current.mutateAsync({
        threadId: 'thread-1',
        input: 'Assess the migration',
        planMode: true,
        permissionProfile: 'full_access',
        clientMessageId: 'mobile-message-1',
      });
    });
    expect(mockCallDesktopAppServerRpc).toHaveBeenCalledWith(
      pairedSession,
      'turn.start',
      expect.objectContaining({
        input: expect.stringContaining('Planning mode is enabled for this turn.'),
        permissionProfile: 'read_only',
        clientUserMessageId: 'mobile-message-1',
      })
    );

    const skills = await renderHookWithQueryClient(() => useDesktopSkillsQuery());
    await waitFor(() => expect(skills.result.current.data?.skills[0]?.name).toBe('security-scan'));
  });

  it('creates Remote worktrees at an authorized path inside the source workspace', async () => {
    mockReadDesktopPairingSession.mockResolvedValue(pairedSession);
    mockCallDesktopAppServerRpc.mockImplementation(async (_session, method: string) => {
      if (method === 'git.worktree.create') {
        return {
          repositoryRoot: '/workspace/repo',
          worktree: {
            path: '/workspace/repo/.taskforceai-worktree-codex-mobile-123',
            bare: false,
            detached: false,
            prunable: false,
          },
          message: 'Git worktree created.',
        };
      }
      return {};
    });
    const worktree = await renderHookWithQueryClient(() => useCreateDesktopWorktreeMutation());

    await act(async () => {
      await worktree.result.current.mutateAsync({
        projectId: 7,
        workspaceRoots: ['/workspace/repo'],
        workspace: '/workspace/repo',
        branch: 'codex/mobile/123',
      });
    });

    expect(mockCallDesktopAppServerRpc).toHaveBeenNthCalledWith(
      1,
      pairedSession,
      'git.worktree.create',
      {
        workspace: '/workspace/repo',
        branch: 'codex/mobile/123',
        baseRef: undefined,
        path: '/workspace/repo/.taskforceai-worktree-codex-mobile-123',
      }
    );
    expect(mockCallDesktopAppServerRpc).toHaveBeenNthCalledWith(
      2,
      pairedSession,
      'project.workspace.set',
      {
        projectId: 7,
        workspaceRoots: [
          '/workspace/repo/.taskforceai-worktree-codex-mobile-123',
          '/workspace/repo',
        ],
      }
    );
  });

  it('queries Remote Git choices and performs project setup actions', async () => {
    mockReadDesktopPairingSession.mockResolvedValue(pairedSession);
    mockCallDesktopAppServerRpc.mockImplementation(async (_session, method: string) => {
      if (method === 'git.branch.list') return { repositoryRoot: '/workspace/repo', branches: [{ name: 'main' }] };
      if (method === 'git.worktree.list') return { repositoryRoot: '/workspace/repo', worktrees: [{ path: '/workspace/repo' }] };
      if (method === 'github.repository.list') return { repositories: [{ nameWithOwner: 'taskforceai/app' }] };
      if (method === 'git.repository.clone') return { repositoryRoot: '/workspace/cloned', message: 'cloned' };
      if (method === 'project.create') return { project: { id: 8, name: 'Created' } };
      return { ok: true };
    });

    const branches = await renderHookWithQueryClient(() =>
      useDesktopGitBranchesQuery('/workspace/repo', true)
    );
    await waitFor(() => expect(branches.result.current.data?.branches).toHaveLength(1));
    const worktrees = await renderHookWithQueryClient(() =>
      useDesktopGitWorktreesQuery('/workspace/repo', true)
    );
    await waitFor(() => expect(worktrees.result.current.data?.worktrees).toHaveLength(1));
    const repositories = await renderHookWithQueryClient(() =>
      useDesktopGitHubRepositoriesQuery(' taskforce ', true)
    );
    await waitFor(() => expect(repositories.result.current.data?.repositories).toHaveLength(1));

    const selectHost = await renderHookWithQueryClient(() => useSelectDesktopHostMutation());
    const attach = await renderHookWithQueryClient(() => useAttachDesktopWorkspaceMutation());
    const create = await renderHookWithQueryClient(() => useCreateDesktopProjectMutation());
    const clone = await renderHookWithQueryClient(() => useCloneDesktopProjectMutation());
    await act(async () => {
      await selectHost.result.current.mutateAsync('saved-host');
      await attach.result.current.mutateAsync({
        projectId: 7,
        workspaceRoots: ['/workspace/repo'],
        workspace: '/workspace/other',
      });
      await create.result.current.mutateAsync({ name: ' New project ', workspace: ' /workspace/new ' });
      await clone.result.current.mutateAsync({
        name: ' Cloned project ',
        remoteUrl: ' https://example.com/repo.git ',
        destination: ' /workspace/cloned ',
      });
    });

    expect(mockSelectDesktopPairingHost).toHaveBeenCalledWith('saved-host');
    expect(mockCallDesktopAppServerRpc).toHaveBeenCalledWith(pairedSession, 'project.workspace.set', {
      projectId: 7,
      workspaceRoots: ['/workspace/other', '/workspace/repo'],
    });
    expect(mockCallDesktopAppServerRpc).toHaveBeenCalledWith(pairedSession, 'workspace.file.list', {
      workspace: '/workspace/new',
      limit: 1,
    });
    expect(mockCallDesktopAppServerRpc).toHaveBeenCalledWith(pairedSession, 'git.repository.clone', {
      remoteUrl: 'https://example.com/repo.git',
      destination: '/workspace/cloned',
    });
  });

  it('routes review and Git finish actions to their scoped RPCs', async () => {
    mockReadDesktopPairingSession.mockResolvedValue(pairedSession);
    const review = await renderHookWithQueryClient(() => useDesktopReviewActionMutation());
    const finish = await renderHookWithQueryClient(() => useDesktopGitFinishMutation());
    await act(async () => {
      await review.result.current.mutateAsync({ kind: 'stage', workspace: '/repo', paths: ['a.ts'], staged: true });
      await review.result.current.mutateAsync({ kind: 'comment', workspace: '/repo', path: 'a.ts', line: 4, body: 'Fix this' });
      await review.result.current.mutateAsync({ kind: 'pullRequest', workspace: '/repo', action: 'approve' });
      await finish.result.current.mutateAsync({ kind: 'checkout', workspace: '/repo', branch: 'main', remote: false });
      await finish.result.current.mutateAsync({ kind: 'createBranch', workspace: '/repo', branch: 'codex/test' });
      await finish.result.current.mutateAsync({ kind: 'commit', workspace: '/repo', message: 'Cover actions' });
      await finish.result.current.mutateAsync({ kind: 'pull', workspace: '/repo' });
      await finish.result.current.mutateAsync({ kind: 'push', workspace: '/repo' });
      await finish.result.current.mutateAsync({ kind: 'createPullRequest', workspace: '/repo', draft: true });
    });

    for (const method of [
      'git.review.stage',
      'git.review.comment.add',
      'git.review.pullRequest.action',
      'git.branch.checkout',
      'git.branch.create',
      'git.repository.commit',
      'git.repository.pull',
      'git.repository.push',
      'git.pullRequest.create',
    ]) {
      expect(mockCallDesktopAppServerRpc).toHaveBeenCalledWith(pairedSession, method, expect.any(Object));
    }
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

  it('retries truncated image previews up to the desktop hard limit', async () => {
    mockReadDesktopPairingSession.mockResolvedValue(pairedSession);
    mockCallDesktopAppServerRpc.mockImplementation(
      async (_session, method: string, params: { maxBytes?: number }) => {
        if (method !== 'workspace.file.read') return {};
        if (params.maxBytes === 256 * 1024) {
          return {
            path: 'preview.png',
            content: '',
            binary: true,
            truncated: true,
            contentBase64: null,
            mimeType: 'image/png',
          };
        }
        return {
          path: 'preview.png',
          content: '',
          binary: true,
          truncated: false,
          contentBase64: 'iVBORw==',
          mimeType: 'image/png',
        };
      }
    );

    const imageHook = await renderHookWithQueryClient(() =>
      useDesktopWorkspaceFileQuery('preview.png', true)
    );
    await waitFor(() => expect(imageHook.result.current.data?.contentBase64).toBe('iVBORw=='));
    expect(mockCallDesktopAppServerRpc).toHaveBeenNthCalledWith(
      1,
      pairedSession,
      'workspace.file.read',
      { workspace: undefined, path: 'preview.png', maxBytes: 256 * 1024 }
    );
    expect(mockCallDesktopAppServerRpc).toHaveBeenNthCalledWith(
      2,
      pairedSession,
      'workspace.file.read',
      { workspace: undefined, path: 'preview.png', maxBytes: 1024 * 1024 }
    );
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

  it('reuses a saved host and an idempotently-created desktop thread', async () => {
    const savedSession = { ...pairedSession, baseUrl: 'https://saved.example' };
    mockReadDesktopPairingHosts.mockResolvedValue([
      { id: 'saved-host', name: 'Saved', session: savedSession, lastConnectedAt: 1 },
    ]);
    mockCallDesktopAppServerRpc.mockImplementation(async (_session, method: string) => {
      if (method === 'thread.start') throw new Error('thread already exists');
      if (method === 'thread.read' || method === 'turn.start') return { thread };
      return {};
    });
    const { result } = await renderHookWithQueryClient(() => useStartDesktopThreadMutation());

    await act(async () => {
      await result.current.mutateAsync({
        input: 'Resume this task',
        hostId: 'saved-host',
        clientMessageId: 'message-1',
      });
    });

    expect(mockCallDesktopAppServerRpc).toHaveBeenCalledWith(
      savedSession,
      'thread.read',
      { threadId: 'mobile-thread-message-1' }
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
