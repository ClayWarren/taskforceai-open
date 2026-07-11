import type {
  AgentStatusSnapshot,
  PendingApproval,
  SourceReference,
  ToolUsageEvent,
} from '../types';

export type StreamSettlement = 'complete' | 'error' | 'abort';

export interface BudgetUsage {
  consumedUsd: number;
  initialUsd?: number;
  remainingUsd?: number;
}

export interface StreamingState {
  isStreaming: boolean;
  agentStatuses: AgentStatusSnapshot[];
  agentLabels: string[];
  errorMessage: string | null;
  rateLimitResetTime: string | null;
  finalResponse: string | null;
  streamContent: string;
  reasoning: string;
  finalReasoning: string | null;
  sources: SourceReference[];
  finalSources: SourceReference[];
  toolEvents: ToolUsageEvent[];
  finalToolEvents: ToolUsageEvent[];
  elapsedSeconds: number;
  modelId: string | null;
  modelLabel: string | null;
  modelBadge: string | null;
  trace_id: string | null;
  pendingApproval: PendingApproval | null;
  computerUseEnabled: boolean;
  useLoggedInServices: boolean;
  currentSpend: number;
  budgetLimit: number | null;
}

export const initialStreamingState: StreamingState = {
  isStreaming: false,
  agentStatuses: [],
  agentLabels: [],
  errorMessage: null,
  rateLimitResetTime: null,
  finalResponse: null,
  streamContent: '',
  reasoning: '',
  finalReasoning: null,
  sources: [],
  finalSources: [],
  toolEvents: [],
  finalToolEvents: [],
  elapsedSeconds: 0,
  modelId: null,
  modelLabel: null,
  modelBadge: null,
  trace_id: null,
  pendingApproval: null,
  computerUseEnabled: false,
  useLoggedInServices: false,
  currentSpend: 0,
  budgetLimit: null,
};
