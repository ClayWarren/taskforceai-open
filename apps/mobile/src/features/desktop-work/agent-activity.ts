import type {
  DesktopInteractionRequest,
  DesktopThread,
} from "./data/desktop-work";

const terminalStates = new Set([
  "completed",
  "cancelled",
  "canceled",
  "failed",
]);

export type AgentActivityRow = {
  hostId: string;
  threadId: string;
  title: string;
  status: "running" | "attention" | "completed" | "failed";
  detail: string;
};

export type AgentActivityProps = {
  machineName: string;
  activeCount: number;
  attentionCount: number;
  rows: AgentActivityRow[];
};

export const remoteAgentActivityProps = (
  threads: DesktopThread[],
  interactions: DesktopInteractionRequest[],
  machineName: string,
): AgentActivityProps => {
  const pendingThreads = new Set(
    interactions
      .map((interaction) => interaction.threadId)
      .filter((id): id is string => Boolean(id)),
  );
  const rows = threads
    .filter((thread) => !thread.archived)
    .filter(
      (thread) =>
        thread.activeRunId ||
        pendingThreads.has(thread.id) ||
        !terminalStates.has(thread.state),
    )
    .toSorted(
      (left, right) =>
        Number(pendingThreads.has(right.id)) -
          Number(pendingThreads.has(left.id)) ||
        right.updatedAt - left.updatedAt,
    )
    .slice(0, 3)
    .map<AgentActivityRow>((thread) => {
      const attention = pendingThreads.has(thread.id);
      const failed = Boolean(thread.lastError) || thread.state === "failed";
      return {
        hostId: thread.hostId,
        threadId: thread.id,
        title: thread.title,
        status: attention
          ? "attention"
          : failed
            ? "failed"
            : thread.activeRunId
              ? "running"
              : "completed",
        detail: attention
          ? "Needs input"
          : failed
            ? "Failed"
            : thread.activeRunId
              ? "Working"
              : "Done",
      };
    });
  return {
    machineName,
    activeCount: rows.filter(
      (row) => row.status === "running" || row.status === "attention",
    ).length,
    attentionCount: rows.filter((row) => row.status === "attention").length,
    rows,
  };
};

export const remoteAgentActivityDeepLink = (row: AgentActivityRow): string =>
  `taskforceai://remote/open?hostId=${encodeURIComponent(row.hostId)}&threadId=${encodeURIComponent(row.threadId)}`;
