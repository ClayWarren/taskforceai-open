import type {
  AgentStatusSnapshot,
  PendingApproval,
  SourceReference,
  ToolUsageEvent,
} from '../types';

export type { AgentStatusSnapshot, PendingApproval, SourceReference, ToolUsageEvent };

export type ToolUsageEventPayload = Omit<Partial<ToolUsageEvent>, 'timestamp'> & {
  timestamp?: string | number;
  invocation_id?: string;
  agent_id?: number;
  agent_label?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_output?: unknown;
  duration_ms?: number;
  status?: string;
};

export interface BudgetUsagePayload {
  initialUsd?: number;
  consumedUsd: number;
  remainingUsd?: number;
}

export interface StreamingPayload {
  type: string;
  agent_statuses?: AgentStatusSnapshot[];
  error?: string;
  message?: string;
  task_id?: string;
  prompt?: string;
  chunk?: string;
  reasoning?: string;
  tool_event?: ToolUsageEvent | ToolUsageEventPayload;
  tool_events?: Array<ToolUsageEvent | ToolUsageEventPayload>;
  tool_usage?: Array<ToolUsageEvent | ToolUsageEventPayload>;
  model_id?: string;
  model_label?: string;
  model_badge?: string;
  agent_count?: number;
  conversation_id?: number;
  trace_id?: string;
  pending_approval?: PendingApproval | null;
  budget_usage?: BudgetUsagePayload;
}
