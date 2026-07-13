import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  callDesktopAppServerRpc,
  DesktopPairingError,
  listDesktopAppServerEvents,
  pingDesktopAppServer,
  respondToDesktopAppServerRequest,
  type DesktopAppServerEvent,
  type DesktopPairingSession,
} from '../../desktop-pairing/client';
import { readDesktopPairingSession } from '../../desktop-pairing/session-store';
import { mobileLogger } from '../../logger';
import { queryKeys } from './queryKeys';

export type DesktopThread = {
  id: string;
  sessionId: string;
  title: string;
  objective: string;
  state: string;
  archived: boolean;
  source: string;
  taskMode: 'chat' | 'work' | 'code';
  parentThreadId?: string | null;
  turns: DesktopTurn[];
  lastMessage?: string | null;
  runIds?: string[];
  activeRunId?: string | null;
  lastError?: string | null;
  createdAt: number;
  updatedAt: number;
};

export type DesktopThreadItem = {
  id: string;
  turnId: string;
  type: string;
  status: string;
  content: unknown;
  createdAt: number;
  updatedAt: number;
};

export type DesktopTurn = {
  id: string;
  threadId: string;
  runId: string;
  status: string;
  items: DesktopThreadItem[];
  createdAt: number;
  updatedAt: number;
};

export type DesktopReviewScope = 'uncommitted' | 'staged' | 'unstaged' | 'allBranchChanges';

export type DesktopReviewFile = {
  path: string;
  oldPath?: string | null;
  status: string;
};

export type DesktopReviewResult = {
  isGitRepository: boolean;
  workspace: string;
  repositoryRoot?: string | null;
  scope: DesktopReviewScope;
  baseRef?: string | null;
  rawDiff: string;
  files: DesktopReviewFile[];
  truncated: boolean;
  message: string;
};

export type DesktopWorkspaceFilesResult = {
  workspace: string;
  files: string[];
  truncated: boolean;
};

export type DesktopWorkspaceFileResult = {
  workspace: string;
  path: string;
  content: string;
  truncated: boolean;
  binary: boolean;
};

export type DesktopProject = {
  id: number;
  name: string;
  description?: string | null;
};

export type DesktopPendingChange = {
  id?: number | null;
  type: string;
  entityId: string;
  operation: string;
  data: unknown;
  createdAt: number;
};

export type DesktopInteractionRequest = {
  id: number | string;
  method: string;
  threadId: string | null;
  params: Record<string, unknown>;
};

export type DesktopPairingConnection = Omit<DesktopPairingSession, 'sessionToken'>;

export type DesktopWorkState =
  | {
      status: 'unpaired';
      projects: [];
      threads: [];
      pendingChanges: [];
      interactions: [];
      activeProjectId: null;
      machineName: null;
      message: string;
    }
  | {
      status: 'connected';
      projects: DesktopProject[];
      threads: DesktopThread[];
      pendingChanges: DesktopPendingChange[];
      interactions: DesktopInteractionRequest[];
      activeProjectId: number | null;
      machineName: string;
      connection: DesktopPairingConnection;
    };

type ThreadListResult = {
  threads?: unknown[];
};

type ProjectListResult = {
  projects?: DesktopProject[];
  activeProjectId?: number | null;
};

type PendingChangeListResult = {
  pendingChanges?: DesktopPendingChange[];
};

type ThreadResult = {
  thread: unknown;
};

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

  await pingDesktopAppServer(session, fetchImpl);
  const [projectList, threadList, changeList, events] = await Promise.all([
    readDesktopProjectList(session, fetchImpl),
    callDesktopAppServerRpc<ThreadListResult>(session, 'thread.list', {}, fetchImpl),
    callDesktopAppServerRpc<PendingChangeListResult>(session, 'pendingChange.list', {}, fetchImpl),
    listDesktopAppServerEvents(session, fetchImpl),
  ]);

  return {
    status: 'connected',
    projects: projectList.projects ?? [],
    threads: (threadList.threads ?? []).map(normalizeDesktopThread),
    pendingChanges: changeList.pendingChanges ?? [],
    interactions: pendingInteractionRequests(events),
    activeProjectId: projectList.activeProjectId ?? null,
    machineName: desktopMachineName(session.baseUrl),
    connection: desktopPairingConnection(session),
  };
};

export const useDesktopWorkStateQuery = (enabled: boolean) =>
  useQuery({
    queryKey: queryKeys.desktopWork,
    queryFn: () => readDesktopWorkState(),
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
    refetchInterval: enabled && threadId ? 2_000 : false,
    staleTime: 1_000,
  });

export const useDesktopReviewQuery = (scope: DesktopReviewScope, enabled: boolean) =>
  useQuery({
    queryKey: queryKeys.desktopReview(scope),
    queryFn: async () => {
      const session = await requireDesktopPairingSession();
      return callDesktopAppServerRpc<DesktopReviewResult>(session, 'git.review.diff', {
        scope,
      });
    },
    enabled,
    staleTime: 2_000,
  });

export const useDesktopWorkspaceFilesQuery = (query: string, enabled: boolean) =>
  useQuery({
    queryKey: queryKeys.desktopWorkspaceFiles(query),
    queryFn: async () => {
      const session = await requireDesktopPairingSession();
      return callDesktopAppServerRpc<DesktopWorkspaceFilesResult>(
        session,
        'workspace.file.list',
        { query: query.trim() || undefined, limit: 300 }
      );
    },
    enabled,
    staleTime: 5_000,
  });

export const useDesktopWorkspaceFileQuery = (path: string | null, enabled: boolean) =>
  useQuery({
    queryKey: queryKeys.desktopWorkspaceFile(path ?? ''),
    queryFn: async () => {
      if (!path) throw new DesktopPairingError('Select a workspace file first.');
      const session = await requireDesktopPairingSession();
      return callDesktopAppServerRpc<DesktopWorkspaceFileResult>(
        session,
        'workspace.file.read',
        { path, maxBytes: 256 * 1024 }
      );
    },
    enabled: enabled && Boolean(path),
    staleTime: 5_000,
  });

export const useSendDesktopTurnMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      threadId,
      input,
      behavior = 'queue',
    }: {
      threadId: string;
      input: string;
      behavior?: 'queue' | 'steer';
    }) => {
      const session = await requireDesktopPairingSession();
      const method = behavior === 'steer' ? 'turn.steer' : 'turn.start';
      return callDesktopAppServerRpc<ThreadResult>(session, method, {
        threadId,
        input,
        ...(behavior === 'queue' ? { quickMode: true } : {}),
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
    mutationFn: async ({ input }: { input: string }) => {
      const session = await requireDesktopPairingSession();
      const started = await callDesktopAppServerRpc<ThreadResult>(session, 'thread.start', {
        objective: input,
        title: titleFromInput(input),
        source: 'mobile',
        taskMode: 'code',
      });
      return { ...started, thread: normalizeDesktopThread(started.thread) };
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
});

const requireDesktopPairingSession = async (): Promise<DesktopPairingSession> => {
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

const normalizeDesktopThread = (value: unknown): DesktopThread => {
  const thread = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const id = stringValue(thread.id) || stringValue(thread.sessionId);
  const turns = Array.isArray(thread.turns) ? (thread.turns as DesktopTurn[]) : [];
  const latestTurn = turns.at(-1);
  const activeTurn = findLastActiveTurn(turns);
  const lastMessage = lastThreadText(turns);
  return {
    id,
    sessionId: id,
    title: stringValue(thread.title) || 'Desktop thread',
    objective: stringValue(thread.objective),
    state: stringValue(thread.state) || 'active',
    archived: Boolean(thread.archived),
    source: stringValue(thread.source) || 'desktop',
    taskMode: taskModeValue(thread.taskMode),
    parentThreadId: optionalString(thread.parentThreadId ?? thread.parentSessionId),
    turns,
    lastMessage: optionalString(thread.lastMessage) ?? lastMessage,
    runIds: Array.isArray(thread.runIds)
      ? thread.runIds.filter((item): item is string => typeof item === 'string')
      : turns.map((turn) => turn.runId),
    activeRunId: optionalString(thread.activeRunId) ?? activeTurn?.runId ?? null,
    lastError: optionalString(thread.lastError) ?? turnError(latestTurn),
    createdAt: numberValue(thread.createdAt),
    updatedAt: numberValue(thread.updatedAt),
  };
};

const findLastActiveTurn = (turns: DesktopTurn[]): DesktopTurn | undefined => {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn?.status === 'in_progress' || turn?.status === 'queued') return turn;
  }
  return undefined;
};

const lastThreadText = (turns: DesktopTurn[]): string | null => {
  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = turns[turnIndex];
    if (!turn) continue;
    for (let itemIndex = turn.items.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = turn.items[itemIndex];
      if (!item) continue;
      const text = threadItemText(item);
      if (text && (item.type === 'agentMessage' || item.type === 'error')) return text;
    }
  }
  return null;
};

export const threadItemText = (item: DesktopThreadItem): string => {
  if (typeof item.content === 'string') return item.content;
  if (item.content && typeof item.content === 'object') {
    const content = item.content as Record<string, unknown>;
    return stringValue(content.text) || stringValue(content.message) || stringValue(content.error);
  }
  return '';
};

const turnError = (turn: DesktopTurn | undefined): string | null => {
  const item = turn?.items.find((candidate) => candidate.type === 'error');
  return item ? threadItemText(item) : null;
};

const stringValue = (value: unknown): string => (typeof value === 'string' ? value : '');
const optionalString = (value: unknown): string | null => {
  const result = stringValue(value);
  return result || null;
};
const numberValue = (value: unknown): number => (typeof value === 'number' ? value : 0);
const taskModeValue = (value: unknown): DesktopThread['taskMode'] =>
  value === 'work' || value === 'code' ? value : 'chat';

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
