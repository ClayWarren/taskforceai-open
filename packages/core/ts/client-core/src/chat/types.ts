import type {
  AgentStatusSnapshot,
  PendingApproval,
  SourceReference,
  ToolUsageEvent,
} from '../types';

export type { PendingApproval };
export type MessageRole = 'user' | 'assistant' | 'system';

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  reasoning?: string;
  isStreaming?: boolean;
  isAgentStatus?: boolean;
  isLocalCommandOutput?: boolean;
  elapsedSeconds?: number;
  error?: string;
  sources?: SourceReference[];
  toolEvents?: ToolUsageEvent[];
  agentStatuses?: AgentStatusSnapshot[];
  createdAt?: number;
  updatedAt?: number;
  rating?: number;
  trace_id?: string;
  pendingApproval?: PendingApproval;
}

export type MessageEvent = {
  eventId: string;
  messageId: string;
  conversationId: string;
  payload: Message;
  receivedAt: number;
};
