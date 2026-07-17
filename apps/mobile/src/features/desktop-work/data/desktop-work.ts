import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '../../../hooks/api/queryKeys';
import { mobileLogger } from '../../../logger';
import {
  callDesktopAppServerRpc,
  DesktopPairingError,
  listDesktopAppServerEvents,
  respondToDesktopAppServerRequest,
  type DesktopAppServerEvent,
  type DesktopPairingSession,
} from '../pairing/client';
import {
  readDesktopPairingHosts,
  readDesktopPairingSession,
  selectDesktopPairingHost,
} from '../pairing/session-store';
import {
  remoteTurnInput,
  type RemotePermissionProfile,
} from '../remote-composer-storage';

import { normalizeDesktopThread } from './desktop-work-normalizers';
import type {
  DesktopEnvironmentWorkState,
  DesktopGitBranch,
  DesktopGitHubRepository,
  DesktopGitStatus,
  DesktopGitWorktree,
  DesktopInteractionRequest,
  DesktopPairingConnection,
  DesktopProject,
  DesktopReviewResult,
  DesktopReviewScope,
  DesktopSkill,
  DesktopWorkspaceFileResult,
  DesktopWorkspaceFilesResult,
  DesktopWorkState,
  PendingChangeListResult,
  ProjectListResult,
  ThreadListResult,
  ThreadResult,
} from './desktop-work.types';

export { threadItemImageUri, threadItemText } from './desktop-work-normalizers';

const WORKSPACE_FILE_PREVIEW_BYTES = 256 * 1024;
const WORKSPACE_IMAGE_PREVIEW_BYTES = 1024 * 1024;
export type {
  DesktopEnvironmentWorkState,
  DesktopGitBranch,
  DesktopGitHubRepository,
  DesktopGitStatus,
  DesktopGitWorktree,
  DesktopInteractionRequest,
  DesktopProject,
  DesktopReviewComment,
  DesktopReviewFile,
  DesktopReviewResult,
  DesktopReviewScope,
  DesktopSkill,
  DesktopThread,
  DesktopThreadItem,
  DesktopWorkspaceFileResult,
  DesktopWorkspaceFilesResult,
  DesktopWorkState,
} from './desktop-work.types';

export const readDesktopWorkState = async (
  fetchImpl: typeof fetch = fetch
): Promise<DesktopWorkState> => {
  const session = await readDesktopPairingSession();
  if (!session) {
    return {
      status: 'unpaired',
      projects: [],
      threads: [],
      pendingChanges: [],
      interactions: [],
      activeProjectId: null,
      machineName: null,
      message: 'Pair this phone with the desktop app to view live work.',
    };
  }

  return readDesktopWorkStateForSession(session, fetchImpl);
};

const readDesktopWorkStateForSession = async (
  session: DesktopPairingSession,
  fetchImpl: typeof fetch
): Promise<DesktopEnvironmentWorkState> => {
  const machineName = session.machineName ?? desktopMachineName(session.baseUrl);
  const hostId = session.baseUrl.toLowerCase();
  const [projectList, threadList, changeList, events] = await Promise.all([
    readDesktopProjectList(session, fetchImpl),
    callDesktopAppServerRpc<ThreadListResult>(session, 'thread.list', {}, fetchImpl),
    callDesktopAppServerRpc<PendingChangeListResult>(session, 'pendingChange.list', {}, fetchImpl),
    listDesktopAppServerEvents(session, fetchImpl),
  ]);

  return {
    status: 'connected',
    projects: (projectList.projects ?? []).map((project) =>
      Object.assign({}, project, { hostId, machineName })
    ),
    threads: (threadList.threads ?? []).map((thread) => normalizeDesktopThread(thread, hostId, machineName)),
    pendingChanges: changeList.pendingChanges ?? [],
    interactions: pendingInteractionRequests(events),
    activeProjectId: projectList.activeProjectId ?? null,
    machineName,
    connection: desktopPairingConnection(session),
  };
};

export const readAllDesktopWorkStates = async (
  fetchImpl: typeof fetch = fetch
): Promise<DesktopEnvironmentWorkState[]> => {
  const hosts = await readDesktopPairingHosts();
  if (hosts.length === 0) {
    const state = await readDesktopWorkState(fetchImpl);
    return state.status === 'connected' ? [state] : [];
  }
  const results = await Promise.allSettled(
    hosts.map((host) => readDesktopWorkStateForSession(host.session, fetchImpl))
  );
  return results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
};

export const useDesktopWorkStateQuery = (enabled: boolean) =>
  useQuery({
    queryKey: queryKeys.desktopWork,
    queryFn: () => readDesktopWorkState(),
    enabled,
    refetchInterval: enabled ? 5_000 : false,
    staleTime: 2_000,
  });

export const useAllDesktopWorkStatesQuery = (enabled: boolean) =>
  useQuery({
    queryKey: [...queryKeys.desktopWork, 'environments'],
    queryFn: () => readAllDesktopWorkStates(),
    enabled,
    refetchInterval: enabled ? 5_000 : false,
    staleTime: 2_000,
  });

export const useDesktopThreadQuery = (threadId: string | null, enabled: boolean) =>
  useQuery({
    queryKey: queryKeys.desktopThread(threadId ?? ''),
    queryFn: async () => {
      if (!threadId) {
        throw new DesktopPairingError('Select a desktop thread first.');
      }
      const session = await requireDesktopPairingSession();
      const result = await callDesktopAppServerRpc<ThreadResult>(session, 'thread.read', {
        threadId,
      });
      return normalizeDesktopThread(result.thread);
    },
    enabled: enabled && Boolean(threadId),
    refetchInterval: enabled && threadId ? 1_000 : false,
    staleTime: 500,
  });

export const useDesktopReviewQuery = (
  scope: DesktopReviewScope,
  workspaceOrEnabled: string | null | boolean,
  requestedEnabled = true,
  threadId: string | null = null
) => {
  const workspace = typeof workspaceOrEnabled === 'boolean' ? null : workspaceOrEnabled;
  const enabled =
    typeof workspaceOrEnabled === 'boolean' ? workspaceOrEnabled : requestedEnabled;
  return useQuery({
    queryKey: queryKeys.desktopReview(scope, workspace ?? '', threadId ?? ''),
    queryFn: async () => {
      const session = await requireDesktopPairingSession();
      return callDesktopAppServerRpc<DesktopReviewResult>(session, 'git.review.diff', {
        scope,
        workspace: workspace ?? undefined,
        ...(scope === 'lastTurn' && threadId ? { threadId } : {}),
      });
    },
    enabled: enabled && (scope !== 'lastTurn' || Boolean(threadId)),
    staleTime: 2_000,
  });
};

export const useDesktopHostsQuery = (enabled: boolean) =>
  useQuery({
    queryKey: queryKeys.desktopHosts,
    queryFn: readDesktopPairingHosts,
    enabled,
    staleTime: 5_000,
  });

export const useDesktopSkillsQuery = (enabled = true) =>
  useQuery({
    queryKey: ['desktopWork', 'skills'],
    queryFn: async () => {
      const session = await requireDesktopPairingSession();
      return callDesktopAppServerRpc<{ skills: DesktopSkill[]; truncated: boolean }>(
        session,
        'skill.list',
        {}
      );
    },
    enabled,
    staleTime: 30_000,
  });

export const useSelectDesktopHostMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (hostId: string) => selectDesktopPairingHost(hostId),
    onSuccess: () => queryClient.resetQueries({ queryKey: queryKeys.desktopWork }),
    onError: (error) => logDesktopMutationError('desktop host selection', error),
  });
};

export const useDesktopGitBranchesQuery = (workspace: string | null, enabled: boolean) =>
  useQuery({
    queryKey: queryKeys.desktopGitBranches(workspace ?? ''),
    queryFn: async () => {
      if (!workspace) throw new DesktopPairingError('Select a project workspace first.');
      const session = await requireDesktopPairingSession();
      return callDesktopAppServerRpc<{ repositoryRoot: string; branches: DesktopGitBranch[] }>(
        session,
        'git.branch.list',
        { workspace }
      );
    },
    enabled: enabled && Boolean(workspace),
    staleTime: 5_000,
  });

export const useDesktopGitWorktreesQuery = (workspace: string | null, enabled: boolean) =>
  useQuery({
    queryKey: queryKeys.desktopGitWorktrees(workspace ?? ''),
    queryFn: async () => {
      if (!workspace) throw new DesktopPairingError('Select a project workspace first.');
      const session = await requireDesktopPairingSession();
      return callDesktopAppServerRpc<{ repositoryRoot: string; worktrees: DesktopGitWorktree[] }>(
        session,
        'git.worktree.list',
        { workspace }
      );
    },
    enabled: enabled && Boolean(workspace),
    staleTime: 5_000,
  });

export const useDesktopGitHubRepositoriesQuery = (query: string, enabled: boolean) =>
  useQuery({
    queryKey: queryKeys.desktopGitHubRepositories(query.trim()),
    queryFn: async () => {
      const session = await requireDesktopPairingSession();
      return callDesktopAppServerRpc<{ repositories: DesktopGitHubRepository[] }>(
        session,
        'github.repository.list',
        { query: query.trim() || undefined }
      );
    },
    enabled,
    staleTime: 30_000,
  });

export const useDesktopGitStatusQuery = (workspace: string | null, enabled: boolean) =>
  useQuery({
    queryKey: queryKeys.desktopGitStatus(workspace ?? ''),
    queryFn: async () => {
      if (!workspace) throw new DesktopPairingError('Select a project workspace first.');
      const session = await requireDesktopPairingSession();
      return callDesktopAppServerRpc<DesktopGitStatus>(session, 'git.review.status', {
        workspace,
      });
    },
    enabled: enabled && Boolean(workspace),
    staleTime: 5_000,
  });

export const useDesktopWorkspaceFilesQuery = (
  workspaceOrQuery: string | null,
  queryOrEnabled: string | boolean,
  requestedEnabled = true
) => {
  const legacyCall = typeof queryOrEnabled === 'boolean';
  const workspace = legacyCall ? null : workspaceOrQuery;
  const query = legacyCall ? (workspaceOrQuery ?? '') : queryOrEnabled;
  const enabled = legacyCall ? queryOrEnabled : requestedEnabled;
  return useQuery({
    queryKey: queryKeys.desktopWorkspaceFiles(workspace ?? '', query),
    queryFn: async () => {
      const session = await requireDesktopPairingSession();
      return callDesktopAppServerRpc<DesktopWorkspaceFilesResult>(
        session,
        'workspace.file.list',
        { workspace: workspace ?? undefined, query: query.trim() || undefined, limit: 300 }
      );
    },
    enabled,
    staleTime: 5_000,
  });
};

export const useDesktopWorkspaceFileQuery = (
  workspaceOrPath: string | null,
  pathOrEnabled: string | null | boolean,
  requestedEnabled = true
) => {
  const legacyCall = typeof pathOrEnabled === 'boolean';
  const workspace = legacyCall ? null : workspaceOrPath;
  const path = legacyCall ? workspaceOrPath : pathOrEnabled;
  const enabled = legacyCall ? pathOrEnabled : requestedEnabled;
  return useQuery({
    queryKey: queryKeys.desktopWorkspaceFile(workspace ?? '', path ?? ''),
    queryFn: async () => {
      if (!path) throw new DesktopPairingError('Select a workspace file first.');
      const session = await requireDesktopPairingSession();
      const preview = await callDesktopAppServerRpc<DesktopWorkspaceFileResult>(
        session,
        'workspace.file.read',
        { workspace: workspace ?? undefined, path, maxBytes: WORKSPACE_FILE_PREVIEW_BYTES }
      );
      if (!preview.truncated || !preview.mimeType?.startsWith('image/')) return preview;
      return callDesktopAppServerRpc<DesktopWorkspaceFileResult>(
        session,
        'workspace.file.read',
        { workspace: workspace ?? undefined, path, maxBytes: WORKSPACE_IMAGE_PREVIEW_BYTES }
      );
    },
    enabled: enabled && Boolean(path),
    staleTime: 5_000,
  });
};

export const useCreateDesktopWorktreeMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      projectId,
      workspaceRoots,
      workspace,
      branch,
      baseRef,
      path,
    }: {
      projectId: number;
      workspaceRoots: string[];
      workspace: string;
      branch: string;
      baseRef?: string | null;
      path?: string | null;
    }) => {
      const session = await requireDesktopPairingSession();
      const worktreePath =
        path?.trim() ||
        `${workspace.replace(/[\\/]+$/, '')}/.taskforceai-worktree-${branch
          .trim()
          .replace(/[^a-zA-Z0-9._-]+/g, '-')}`;
      const result = await callDesktopAppServerRpc<{
        repositoryRoot: string;
        worktree: DesktopGitWorktree;
        message: string;
      }>(session, 'git.worktree.create', {
        workspace,
        branch: branch.trim(),
        baseRef: baseRef?.trim() || undefined,
        path: worktreePath,
      });
      const roots = [result.worktree.path, ...workspaceRoots].filter(
        (root, index, all) => all.indexOf(root) === index
      );
      await callDesktopAppServerRpc(session, 'project.workspace.set', {
        projectId,
        workspaceRoots: roots,
      });
      return result;
    },
    onSuccess: async (_, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.desktopWork }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.desktopGitWorktrees(variables.workspace),
        }),
      ]);
    },
    onError: (error) => logDesktopMutationError('worktree creation', error),
  });
};

export const useAttachDesktopWorkspaceMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      projectId,
      workspaceRoots,
      workspace,
    }: {
      projectId: number;
      workspaceRoots: string[];
      workspace: string;
    }) => {
      const session = await requireDesktopPairingSession();
      const roots = [workspace, ...workspaceRoots].filter(
        (root, index, all) => all.indexOf(root) === index
      );
      return callDesktopAppServerRpc(session, 'project.workspace.set', {
        projectId,
        workspaceRoots: roots,
      });
    },
    onSuccess: () => invalidateDesktopWork(queryClient),
    onError: (error) => logDesktopMutationError('workspace attachment', error),
  });
};

export const useCreateDesktopProjectMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, workspace }: { name: string; workspace: string }) => {
      const session = await requireDesktopPairingSession();
      await callDesktopAppServerRpc(session, 'workspace.file.list', {
        workspace: workspace.trim(),
        limit: 1,
      });
      return callDesktopAppServerRpc<{ project: DesktopProject }>(session, 'project.create', {
        name: name.trim(),
        workspaceRoots: [workspace.trim()],
      });
    },
    onSuccess: () => invalidateDesktopWork(queryClient),
    onError: (error) => logDesktopMutationError('project creation', error),
  });
};

export const useCloneDesktopProjectMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      name,
      remoteUrl,
      destination,
    }: {
      name: string;
      remoteUrl: string;
      destination: string;
    }) => {
      const session = await requireDesktopPairingSession();
      const cloned = await callDesktopAppServerRpc<{ repositoryRoot: string; message: string }>(
        session,
        'git.repository.clone',
        { remoteUrl: remoteUrl.trim(), destination: destination.trim() }
      );
      return callDesktopAppServerRpc<{ project: DesktopProject }>(session, 'project.create', {
        name: name.trim(),
        workspaceRoots: [cloned.repositoryRoot],
      });
    },
    onSuccess: () => invalidateDesktopWork(queryClient),
    onError: (error) => logDesktopMutationError('repository clone', error),
  });
};

export const useDesktopReviewActionMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      input:
        | { kind: 'stage'; workspace: string; paths: string[]; staged: boolean }
        | {
            kind: 'comment';
            workspace: string;
            path: string;
            line: number;
            endLine?: number | null;
            body: string;
          }
        | {
            kind: 'pullRequest';
            workspace: string;
            action: 'comment' | 'approve' | 'requestChanges' | 'markReady';
            body?: string;
          }
    ) => {
      const session = await requireDesktopPairingSession();
      if (input.kind === 'stage') {
        return callDesktopAppServerRpc(session, 'git.review.stage', input);
      }
      if (input.kind === 'comment') {
        return callDesktopAppServerRpc(session, 'git.review.comment.add', input);
      }
      return callDesktopAppServerRpc(session, 'git.review.pullRequest.action', input);
    },
    onSuccess: async (_, input) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['desktopWork', 'review'] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.desktopGitStatus(input.workspace) }),
      ]);
    },
    onError: (error) => logDesktopMutationError('review action', error),
  });
};

export type DesktopGitFinishAction =
  | { kind: 'checkout'; workspace: string; branch: string; remote: boolean }
  | { kind: 'createBranch'; workspace: string; branch: string; baseRef?: string }
  | { kind: 'commit'; workspace: string; message: string }
  | { kind: 'pull'; workspace: string }
  | { kind: 'push'; workspace: string }
  | {
      kind: 'createPullRequest';
      workspace: string;
      title?: string;
      body?: string;
      base?: string;
      draft: boolean;
    };

export const useDesktopGitFinishMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: DesktopGitFinishAction) => {
      const session = await requireDesktopPairingSession();
      switch (input.kind) {
        case 'checkout':
          return callDesktopAppServerRpc<{ ok: boolean; message: string }>(
            session,
            'git.branch.checkout',
            input
          );
        case 'createBranch':
          return callDesktopAppServerRpc<{ ok: boolean; message: string }>(
            session,
            'git.branch.create',
            input
          );
        case 'commit':
          return callDesktopAppServerRpc<{ ok: boolean; message: string }>(
            session,
            'git.repository.commit',
            input
          );
        case 'pull':
          return callDesktopAppServerRpc<{ ok: boolean; message: string }>(
            session,
            'git.repository.pull',
            input
          );
        case 'push':
          return callDesktopAppServerRpc<{ ok: boolean; message: string }>(
            session,
            'git.repository.push',
            input
          );
        case 'createPullRequest':
          return callDesktopAppServerRpc<{ ok: boolean; message: string }>(
            session,
            'git.pullRequest.create',
            input
          );
      }
    },
    onSuccess: async (_, input) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.desktopGitStatus(input.workspace) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.desktopGitBranches(input.workspace) }),
        queryClient.invalidateQueries({ queryKey: ['desktopWork', 'review'] }),
      ]);
    },
    onError: (error) => logDesktopMutationError('Git action', error),
  });
};

export const useSendDesktopTurnMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      threadId,
      input,
      behavior = 'queue',
      modelId,
      reasoningEffort,
      attachmentIds = [],
      planMode = false,
      permissionProfile,
      clientMessageId,
    }: {
      threadId: string;
      input: string;
      behavior?: 'queue' | 'steer';
      modelId?: string | null;
      reasoningEffort?: string | null;
      attachmentIds?: string[];
      planMode?: boolean;
      permissionProfile?: RemotePermissionProfile;
      clientMessageId?: string;
    }) => {
      const session = await requireDesktopPairingSession();
      const method = behavior === 'steer' ? 'turn.steer' : 'turn.start';
      return callDesktopAppServerRpc<ThreadResult>(session, method, {
        threadId,
        input: behavior === 'queue' ? remoteTurnInput(input, planMode) : input,
        ...(behavior === 'queue'
          ? {
              quickMode: true,
              modelId: modelId ?? undefined,
              reasoningEffort: reasoningEffort ?? undefined,
              attachmentIds,
              ...(planMode || permissionProfile
                ? { permissionProfile: planMode ? 'read_only' : permissionProfile }
                : {}),
              ...(clientMessageId ? { clientUserMessageId: clientMessageId } : {}),
            }
          : {}),
      });
    },
    onSuccess: () => {
      void invalidateDesktopWork(queryClient);
    },
    onError: (error) => {
      mobileLogger.error('[useSendDesktopTurnMutation] Failed to send desktop turn', {
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      });
    },
  });
};

export const useStartDesktopThreadMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      input,
      taskMode = 'code',
      projectId,
      workspaceRoot,
      modelId,
      reasoningEffort,
      attachmentIds = [],
      planMode = false,
      permissionProfile,
      hostId,
      clientMessageId,
    }: {
      input: string;
      taskMode?: 'chat' | 'code';
      projectId?: number | null;
      workspaceRoot?: string | null;
      modelId?: string | null;
      reasoningEffort?: string | null;
      attachmentIds?: string[];
      planMode?: boolean;
      permissionProfile?: RemotePermissionProfile;
      hostId?: string | null;
      clientMessageId?: string;
    }) => {
      const session = await requireDesktopPairingSession(hostId);
      await callDesktopAppServerRpc(
        session,
        projectId != null ? 'project.use' : 'project.clear',
        projectId != null ? { projectId } : {}
      );
      const threadId = clientMessageId ? `mobile-thread-${clientMessageId}` : undefined;
      let started: ThreadResult;
      try {
        started = await callDesktopAppServerRpc<ThreadResult>(session, 'thread.start', {
          objective: input,
          threadId,
          title: titleFromInput(input),
          source: 'mobile',
          taskMode,
        });
      } catch (error) {
        if (!threadId || !(error instanceof Error) || !error.message.includes('already exists')) {
          throw error;
        }
        started = await callDesktopAppServerRpc<ThreadResult>(session, 'thread.read', { threadId });
      }
      const thread = normalizeDesktopThread(started.thread);
      try {
        const turn = await callDesktopAppServerRpc<ThreadResult>(session, 'turn.start', {
          threadId: thread.id,
          input: remoteTurnInput(input, planMode),
          quickMode: taskMode === 'chat',
          autonomous: false,
          modelId: modelId ?? undefined,
          reasoningEffort: reasoningEffort ?? undefined,
          projectId: projectId ?? undefined,
          ...(workspaceRoot ? { workspaceRoot } : {}),
          attachmentIds,
          ...(clientMessageId ? { clientUserMessageId: clientMessageId } : {}),
          ...(planMode || permissionProfile
            ? { permissionProfile: planMode ? 'read_only' : permissionProfile }
            : {}),
        });
        return { ...turn, thread: normalizeDesktopThread(turn.thread) };
      } catch (error) {
        await callDesktopAppServerRpc(session, 'thread.delete', { threadId: thread.id }).catch(
          () => undefined
        );
        throw error;
      }
    },
    onSuccess: () => {
      void invalidateDesktopWork(queryClient);
    },
    onError: (error) => {
      mobileLogger.error('[useStartDesktopThreadMutation] Failed to start desktop thread', {
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      });
    },
  });
};

export const useRespondDesktopInteractionMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      requestId,
      decision,
      response,
    }: {
      requestId: number | string;
      decision?: 'accept' | 'acceptForSession' | 'decline' | 'cancel';
      response?: unknown;
    }) => {
      const session = await readDesktopPairingSession();
      if (!session) {
        throw new DesktopPairingError('Pair this phone with the desktop app first.');
      }
      await respondToDesktopAppServerRequest(
        session,
        requestId,
        response ?? { decision: decision ?? 'cancel' }
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.desktopWork });
    },
    onError: (error) => {
      mobileLogger.error('[useRespondDesktopInteractionMutation] Failed to respond', {
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      });
    },
  });
};

const pendingInteractionRequests = (
  events: DesktopAppServerEvent[]
): DesktopInteractionRequest[] => {
  const resolved = new Set<number | string>();
  for (const event of events) {
    if (event.method !== 'serverRequest/resolved' || !isRecord(event.params)) continue;
    const requestId = event.params.requestId;
    if (typeof requestId === 'number' || typeof requestId === 'string') resolved.add(requestId);
  }
  return events.flatMap((event) => {
    if (
      (typeof event.id !== 'number' && typeof event.id !== 'string') ||
      typeof event.method !== 'string' ||
      !event.method.includes('request') ||
      !isRecord(event.params) ||
      resolved.has(event.id)
    ) {
      return [];
    }
    return [
      {
        id: event.id,
        method: event.method,
        threadId: typeof event.params.threadId === 'string' ? event.params.threadId : null,
        params: event.params,
      },
    ];
  });
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export type DesktopThreadAction =
  | 'archive'
  | 'unarchive'
  | 'resume'
  | 'cancel'
  | 'fork'
  | 'delete';

export const useDesktopThreadActionMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ threadId, action }: { threadId: string; action: DesktopThreadAction }) => {
      const session = await requireDesktopPairingSession();
      return callDesktopAppServerRpc<ThreadResult | { ok: boolean }>(
        session,
        `thread.${action}`,
        { threadId }
      );
    },
    onSuccess: () => void invalidateDesktopWork(queryClient),
    onError: (error) => logDesktopMutationError('thread action', error),
  });
};

export const useRenameDesktopThreadMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ threadId, title }: { threadId: string; title: string }) => {
      const session = await requireDesktopPairingSession();
      return callDesktopAppServerRpc<ThreadResult>(session, 'thread.name.set', {
        threadId,
        title: title.trim(),
      });
    },
    onSuccess: () => void invalidateDesktopWork(queryClient),
    onError: (error) => logDesktopMutationError('thread rename', error),
  });
};

export const useInterruptDesktopTurnMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ threadId }: { threadId: string }) => {
      const session = await requireDesktopPairingSession();
      return callDesktopAppServerRpc<ThreadResult>(session, 'turn.interrupt', { threadId });
    },
    onSuccess: () => void invalidateDesktopWork(queryClient),
    onError: (error) => logDesktopMutationError('turn interrupt', error),
  });
};

const readDesktopProjectList = async (
  session: DesktopPairingSession,
  fetchImpl: typeof fetch
): Promise<ProjectListResult> => {
  try {
    return await callDesktopAppServerRpc<ProjectListResult>(session, 'project.list', {}, fetchImpl);
  } catch (error) {
    mobileLogger.debug('[readDesktopWorkState] Desktop project metadata unavailable', {
      error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
    });
    return { projects: [], activeProjectId: null };
  }
};

const desktopPairingConnection = (session: DesktopPairingSession): DesktopPairingConnection => ({
  baseUrl: session.baseUrl,
  rpcPath: session.rpcPath,
  transport: session.transport,
  targetDeviceId: session.targetDeviceId,
  controllerDeviceId: session.controllerDeviceId,
  machineName: session.machineName,
});

const requireDesktopPairingSession = async (
  hostId?: string | null
): Promise<DesktopPairingSession> => {
  if (hostId) {
    const host = (await readDesktopPairingHosts()).find((candidate) => candidate.id === hostId);
    if (host) return host.session;
  }
  const session = await readDesktopPairingSession();
  if (!session) {
    throw new DesktopPairingError('Pair this phone with the desktop app first.');
  }
  return session;
};

const invalidateDesktopWork = async (queryClient: ReturnType<typeof useQueryClient>) => {
  await queryClient.invalidateQueries({ queryKey: queryKeys.desktopWork });
};

const logDesktopMutationError = (label: string, error: unknown) => {
  mobileLogger.error(`[desktopWork] Failed ${label}`, {
    error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
  });
};

const desktopMachineName = (baseUrl: string): string => {
  try {
    const host = new URL(baseUrl).hostname;
    if (host === '127.0.0.1' || host === 'localhost') {
      return 'This Mac';
    }
    return host;
  } catch {
    return 'Desktop';
  }
};

const titleFromInput = (input: string): string => {
  const firstLine = input.trim().split(/\s+/).slice(0, 7).join(' ');
  return firstLine || 'Desktop thread';
};
