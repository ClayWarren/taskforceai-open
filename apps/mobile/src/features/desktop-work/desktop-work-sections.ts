import type {
  DesktopInteractionRequest,
  DesktopProject,
  DesktopThread,
} from './data/desktop-work';

export type RemoteOrganizeMode = 'project' | 'chronological' | 'chatsFirst';
export type RemoteThreadFilter = 'all' | 'running' | 'needsInput' | 'completed' | 'archived';

export type WorkspaceGroup = {
  projectId: number | null;
  name: string;
  expanded: boolean;
  threads: DesktopThread[];
};

export type RemoteSection = {
  key: string;
  title: string;
  kind: 'projects' | 'chats' | 'dated';
  workspaces: WorkspaceGroup[];
  threads: DesktopThread[];
};

export const remoteThreadFilters: Array<{ value: RemoteThreadFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'running', label: 'Running' },
  { value: 'needsInput', label: 'Needs input' },
  { value: 'completed', label: 'Completed' },
  { value: 'archived', label: 'Archived' },
];

export const filterRemoteThreads = (
  threads: DesktopThread[],
  interactions: DesktopInteractionRequest[],
  search: string,
  filter: RemoteThreadFilter
): DesktopThread[] => {
  const query = search.trim().toLowerCase();
  const interactionThreadIds = new Set(
    interactions.map((interaction) => interaction.threadId).filter((id): id is string => Boolean(id))
  );
  return threads.filter((thread) => {
    const turns = thread.turns ?? [];
    const hasActiveTurn = turns.some(
      (turn) => turn.status === 'inProgress' || turn.status === 'queued'
    );
    const needsInput =
      interactionThreadIds.has(thread.id) ||
      turns.some((turn) =>
        turn.items.some(
          (item) =>
            item.status === 'inProgress' &&
            (item.type === 'approval' || item.type === 'toolCall')
        )
      );
    const matchesFilter =
      filter === 'all' ||
      (filter === 'running' && hasActiveTurn) ||
      (filter === 'needsInput' && needsInput) ||
      (filter === 'completed' && !hasActiveTurn && !needsInput && !thread.archived) ||
      (filter === 'archived' && thread.archived);
    if (!matchesFilter) return false;
    if (!query) return true;
    return `${thread.title} ${thread.objective} ${thread.lastMessage ?? ''} ${JSON.stringify(turns)}`
      .toLowerCase()
      .includes(query);
  });
};

export const makeRemoteSections = (
  projects: DesktopProject[],
  threads: DesktopThread[],
  activeProjectId: number | null,
  organizeMode: RemoteOrganizeMode,
  now = Date.now()
): RemoteSection[] => {
  // Hermes in the current TestFlight runtime does not implement Array.prototype.toSorted.
  // Copy first so the compatibility fallback cannot mutate React Query's cached value.
  // oxlint-disable-next-line unicorn/no-array-sort
  const sorted = [...threads].sort((left, right) => right.updatedAt - left.updatedAt);
  if (organizeMode === 'chronological') {
    const groups = new Map<string, DesktopThread[]>();
    for (const thread of sorted) {
      const label = relativeDayLabel(thread.updatedAt, now);
      groups.set(label, [...(groups.get(label) ?? []), thread]);
    }
    return [...groups.entries()].map(([title, datedThreads]) => ({
      key: `dated-${title}`,
      title,
      kind: 'dated',
      workspaces: [],
      threads: datedThreads,
    }));
  }

  const chats = sorted.filter((thread) => thread.taskMode === 'chat');
  const projectThreads = sorted.filter((thread) => thread.taskMode !== 'chat');
  const workspaces = makeProjectGroups(projects, projectThreads, activeProjectId);
  const projectSection: RemoteSection | null =
    workspaces.length > 0
      ? { key: 'projects', title: 'Projects', kind: 'projects', workspaces, threads: [] }
      : null;
  const chatSection: RemoteSection = {
    key: 'chats',
    title: 'Chats',
    kind: 'chats',
    workspaces: [],
    threads: chats,
  };
  const ordered =
    organizeMode === 'chatsFirst'
      ? [chatSection, projectSection]
      : [projectSection, chatSection];
  return ordered.filter((section): section is RemoteSection => section !== null);
};

export const activeProjectName = (
  projects: DesktopProject[],
  activeProjectId: number | null
): string => {
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0];
  return activeProject?.name ?? 'Desktop workspace';
};

const makeProjectGroups = (
  projects: DesktopProject[],
  threads: DesktopThread[],
  activeProjectId: number | null
): WorkspaceGroup[] => {
  if (projects.length === 0) {
    return threads.length === 0
      ? []
      : [{ projectId: null, name: 'Desktop workspace', expanded: true, threads }];
  }

  const activeName = activeProjectName(projects, activeProjectId);
  return projects.map((project) => ({
    projectId: project.id,
    name: project.name,
    expanded: true,
    threads: project.name === activeName ? threads : [],
  }));
};

const relativeDayLabel = (timestamp: number, now: number): string => {
  const value = new Date(timestamp);
  const current = new Date(now);
  if (!Number.isFinite(timestamp) || Number.isNaN(value.getTime())) return 'Earlier';
  const valueDay = Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  const currentDay = Date.UTC(current.getFullYear(), current.getMonth(), current.getDate());
  const daysAgo = Math.max(0, Math.round((currentDay - valueDay) / 86_400_000));
  if (daysAgo === 0) return 'Today';
  if (daysAgo === 1) return 'Yesterday';
  return `${daysAgo} days ago`;
};
