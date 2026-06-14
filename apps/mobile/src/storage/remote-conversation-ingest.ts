import type { ConversationSummary } from '@taskforceai/contracts/contracts';

import type { AgentStatus, SourceReference, ToolUsageEvent } from '../types';
import type { LocalMessage } from './chat-local-mobile.internal';

type RemoteConversationMessage = {
  conversationId: string;
  messageId: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming: false;
  isAgentStatus?: boolean;
  sources?: SourceReference[];
  toolEvents?: ToolUsageEvent[];
  agentStatuses?: AgentStatus[];
  elapsedSeconds?: number;
  createdAt: number;
  updatedAt: number;
};

export type RemoteConversationIngestPlan = {
  remoteConversationId: string;
  createdAt: number;
  userMessage: RemoteConversationMessage;
  agentStatusMessage: RemoteConversationMessage;
  assistantMessage: RemoteConversationMessage;
};

export function createRemoteConversationIngestPlan(
  summary: ConversationSummary,
  existingMessages: LocalMessage[]
): RemoteConversationIngestPlan {
  const remoteConversationId = `remote-${summary.id}`;
  const createdAt = new Date(summary.timestamp).getTime();
  const userMessageId = `${remoteConversationId}-user`;
  const assistantMessageId = `${remoteConversationId}-assistant`;
  const agentStatusMessageId = `${remoteConversationId}-agent-status`;

  const existingAgentStatusMsg = existingMessages.find(
    (message) => message.messageId === agentStatusMessageId
  );
  const existingAssistantMsg = existingMessages.find(
    (message) => message.messageId === assistantMessageId
  );

  const summarySources =
    Array.isArray(summary.sources) && summary.sources.length > 0 ? summary.sources : undefined;
  const summaryAgentStatuses =
    Array.isArray(summary.agentStatuses) && summary.agentStatuses.length > 0
      ? summary.agentStatuses
      : undefined;
  const sharedSources =
    summarySources ?? existingAssistantMsg?.sources ?? existingAgentStatusMsg?.sources ?? [];

  return {
    remoteConversationId,
    createdAt,
    userMessage: {
      conversationId: remoteConversationId,
      messageId: userMessageId,
      role: 'user',
      content: summary.user_input ?? '',
      isStreaming: false,
      createdAt,
      updatedAt: createdAt,
    },
    agentStatusMessage: {
      conversationId: remoteConversationId,
      messageId: agentStatusMessageId,
      role: 'assistant',
      content: '',
      isStreaming: false,
      isAgentStatus: true,
      agentStatuses: summaryAgentStatuses ?? existingAgentStatusMsg?.agentStatuses ?? [],
      sources: sharedSources,
      toolEvents: existingAgentStatusMsg?.toolEvents ?? [],
      createdAt,
      updatedAt: createdAt,
      elapsedSeconds:
        summary.execution_time !== undefined ? Math.round(summary.execution_time) : undefined,
    },
    assistantMessage: {
      conversationId: remoteConversationId,
      messageId: assistantMessageId,
      role: 'assistant',
      content: summary.result ?? '',
      isStreaming: false,
      isAgentStatus: false,
      sources: sharedSources,
      toolEvents: existingAssistantMsg?.toolEvents ?? [],
      createdAt,
      updatedAt: createdAt,
    },
  };
}
