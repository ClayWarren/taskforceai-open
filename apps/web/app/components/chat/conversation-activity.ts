import type { ConversationSummary } from '@taskforceai/contracts/contracts';

export type ConversationActivity = 'working' | 'attention' | 'error' | 'completed';

const WORKING_STATUS_TOKENS = ['RUNNING', 'PROCESSING', 'STARTING', 'STREAMING', 'BUSY'];
const ATTENTION_STATUS_TOKENS = ['APPROVAL', 'AWAITING', 'INPUT', 'PAUSED', 'BLOCKED'];
const ERROR_STATUS_TOKENS = ['ERROR', 'FAILED', 'FAILURE'];

const includesStatusToken = (status: string, tokens: readonly string[]): boolean =>
  tokens.some((token) => status.includes(token));

export function resolveConversationActivity(input: {
  conversation: Pick<ConversationSummary, 'agentStatuses'>;
  activeActivity?: ConversationActivity | null;
  hasUnread: boolean;
  isActive: boolean;
}): ConversationActivity | null {
  if (input.isActive && input.activeActivity) return input.activeActivity;

  const statuses = input.conversation.agentStatuses ?? [];
  if (
    statuses.some((status) =>
      includesStatusToken(status.status.toUpperCase(), ATTENTION_STATUS_TOKENS)
    )
  ) {
    return 'attention';
  }
  if (
    statuses.some((status) => includesStatusToken(status.status.toUpperCase(), ERROR_STATUS_TOKENS))
  ) {
    return 'error';
  }
  if (
    statuses.some((status) =>
      includesStatusToken(status.status.toUpperCase(), WORKING_STATUS_TOKENS)
    )
  ) {
    return 'working';
  }
  return input.hasUnread ? 'completed' : null;
}

export const conversationActivityPresentation: Record<
  ConversationActivity,
  { label: string; dotClassName: string }
> = {
  working: {
    label: 'Task is working',
    dotClassName: 'animate-pulse bg-sky-400',
  },
  attention: {
    label: 'Task needs attention',
    dotClassName: 'bg-amber-400',
  },
  error: {
    label: 'Task failed',
    dotClassName: 'bg-red-400',
  },
  completed: {
    label: 'Task completed with new activity',
    dotClassName: 'bg-emerald-400',
  },
};
