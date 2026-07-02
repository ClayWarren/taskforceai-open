import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  callDesktopAppServerRpc,
  DesktopPairingError,
  pingDesktopAppServer,
  type DesktopPairingSession,
} from '../../desktop-pairing/client';
import { readDesktopPairingSession } from '../../desktop-pairing/session-store';
import { mobileLogger } from '../../logger';
import { queryKeys } from './queryKeys';

export type DesktopThread = {
  sessionId: string;
  title: string;
  objective: string;
  state: string;
  source: string;
  lastMessage?: string | null;
  runIds?: string[];
  activeRunId?: string | null;
  lastError?: string | null;
  createdAt: number;
  updatedAt: number;
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

export type DesktopPairingConnection = Omit<DesktopPairingSession, 'sessionToken'>;

export type DesktopWorkState =
  | {
      status: 'unpaired';
      projects: [];
      threads: [];
      pendingChanges: [];
      activeProjectId: null;
      machineName: null;
      message: string;
    }
  | {
      status: 'connected';
      projects: DesktopProject[];
      threads: DesktopThread[];
      pendingChanges: DesktopPendingChange[];
      activeProjectId: number | null;
      machineName: string;
      connection: DesktopPairingConnection;
    };

type ThreadListResult = {
  threads?: DesktopThread[];
};

type ProjectListResult = {
  projects?: DesktopProject[];
  activeProjectId?: number | null;
};

type PendingChangeListResult = {
  pendingChanges?: DesktopPendingChange[];
};

type ThreadResult = {
  thread: DesktopThread;
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
      activeProjectId: null,
      machineName: null,
      message: 'Pair this phone with the desktop app to view live work.',
    };
  }

  await pingDesktopAppServer(session, fetchImpl);
  const [projectList, threadList, changeList] = await Promise.all([
    readDesktopProjectList(session, fetchImpl),
    callDesktopAppServerRpc<ThreadListResult>(session, 'thread.list', {}, fetchImpl),
    callDesktopAppServerRpc<PendingChangeListResult>(session, 'pendingChange.list', {}, fetchImpl),
  ]);

  return {
    status: 'connected',
    projects: projectList.projects ?? [],
    threads: threadList.threads ?? [],
    pendingChanges: changeList.pendingChanges ?? [],
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

export const useSendDesktopTurnMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ threadId, input }: { threadId: string; input: string }) => {
      const session = await readDesktopPairingSession();
      if (!session) {
        throw new DesktopPairingError('Pair this phone with the desktop app first.');
      }
      return callDesktopAppServerRpc<ThreadResult>(session, 'turn.start', {
        threadId,
        input,
        quickMode: true,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.desktopWork });
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
      const session = await readDesktopPairingSession();
      if (!session) {
        throw new DesktopPairingError('Pair this phone with the desktop app first.');
      }
      const started = await callDesktopAppServerRpc<ThreadResult>(session, 'thread.start', {
        objective: input,
        title: titleFromInput(input),
        source: 'mobile',
      });
      return started;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.desktopWork });
    },
    onError: (error) => {
      mobileLogger.error('[useStartDesktopThreadMutation] Failed to start desktop thread', {
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      });
    },
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
