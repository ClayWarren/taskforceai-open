import type { DesktopPairingSession } from '../pairing/client';

export type DesktopThread = {
  id: string;
  sessionId: string;
  hostId: string;
  machineName: string;
  projectId: number | null;
  workspaceRoot: string | null;
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

export type DesktopReviewScope =
  | 'lastTurn'
  | 'uncommitted'
  | 'staged'
  | 'unstaged'
  | 'allBranchChanges';

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
  contentBase64?: string | null;
  mimeType?: string | null;
};

export type DesktopProject = {
  id: number;
  hostId: string;
  machineName: string;
  name: string;
  description?: string | null;
  workspaceRoots?: string[];
};

export type DesktopSkill = {
  name: string;
  description: string;
  path: string;
  source: string;
  enabled: boolean;
};

export type DesktopGitStatus = {
  isGitRepository: boolean;
  workspace: string;
  repositoryRoot?: string | null;
  branch?: string | null;
  head?: string | null;
  upstream?: string | null;
  baseRef?: string | null;
  hasStagedChanges: boolean;
  hasUnstagedChanges: boolean;
  hasUntrackedFiles: boolean;
  files: Array<{
    path: string;
    staged: boolean;
    unstaged: boolean;
    untracked: boolean;
  }>;
  message: string;
  pullRequest?: {
    number: number;
    title: string;
    url: string;
    isDraft: boolean;
  } | null;
};

export type DesktopGitBranch = {
  name: string;
  current: boolean;
  remote: boolean;
};

export type DesktopGitWorktree = {
  path: string;
  head?: string | null;
  branch?: string | null;
  bare: boolean;
  detached: boolean;
  prunable: boolean;
};

export type DesktopGitHubRepository = {
  nameWithOwner: string;
  url: string;
  description?: string | null;
  isPrivate: boolean;
  updatedAt?: string | null;
};

export type DesktopReviewComment = {
  id: string;
  workspace: string;
  path: string;
  line: number;
  endLine?: number | null;
  body: string;
  resolved: boolean;
  createdAt: number;
  updatedAt: number;
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

export type ThreadListResult = {
  threads?: unknown[];
};

export type ProjectListResult = {
  projects?: DesktopProject[];
  activeProjectId?: number | null;
};

export type PendingChangeListResult = {
  pendingChanges?: DesktopPendingChange[];
};

export type ThreadResult = {
  thread: unknown;
};

export type DesktopEnvironmentWorkState = Extract<DesktopWorkState, { status: 'connected' }>;

