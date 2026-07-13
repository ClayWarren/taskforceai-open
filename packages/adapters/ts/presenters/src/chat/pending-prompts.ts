import { countBy } from '@taskforceai/client-core/utils/collection';

export type PendingPromptPrimaryStatus = 'queued' | 'pending' | 'failed';
export type PendingPromptStatus = PendingPromptPrimaryStatus | (string & {});

export interface PendingPromptLike {
  status: PendingPromptStatus;
}

export interface PendingPromptSummary {
  totalCount: number;
  queuedCount: number;
  pendingCount: number;
  failedCount: number;
  primaryStatus: PendingPromptPrimaryStatus;
  savedTitle: string;
  statusLabel: string;
  webQueueLabel: string;
  failedRetryLabel: string | null;
}

const pluralize = (count: number, singular: string, plural = `${singular}s`): string =>
  `${count} ${count === 1 ? singular : plural}`;

export const summarizePendingPrompts = (
  prompts: readonly PendingPromptLike[]
): PendingPromptSummary => {
  const statusCounts = countBy(Array.from(prompts), (prompt) => prompt.status);
  const queuedCount = statusCounts['queued'] ?? 0;
  const pendingCount = statusCounts['pending'] ?? 0;
  const failedCount = statusCounts['failed'] ?? 0;
  const primaryStatus: PendingPromptPrimaryStatus =
    failedCount > 0 ? 'failed' : pendingCount > 0 ? 'pending' : 'queued';
  const statusLabel =
    primaryStatus === 'failed'
      ? `${failedCount} failed`
      : primaryStatus === 'pending'
        ? `${pendingCount} pending`
        : `${queuedCount} queued`;
  const failedRetryLabel =
    failedCount > 0
      ? `${pluralize(failedCount, 'message')} failed to send. Remove or resubmit when ready.`
      : null;

  return {
    totalCount: prompts.length,
    queuedCount,
    pendingCount,
    failedCount,
    primaryStatus,
    savedTitle: pluralize(prompts.length, 'prompt', 'prompts') + ' saved',
    statusLabel,
    webQueueLabel: `${pluralize(queuedCount, 'message')} queued${
      pendingCount > 0 ? `, ${pendingCount} processing` : ''
    }`,
    failedRetryLabel,
  };
};

export const pendingPromptStatusColor = (status: PendingPromptPrimaryStatus): string => {
  if (status === 'failed') {
    return '#f87171';
  }
  if (status === 'pending') {
    return '#fbbf24';
  }
  return '#60a5fa';
};
