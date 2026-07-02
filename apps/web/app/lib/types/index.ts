import type { Message as SharedMessage } from '@taskforceai/shared/chat/types';
import type { ExecutionTrace as SharedExecutionTrace } from '@taskforceai/contracts/contracts';
import type {
  AgentStatusSnapshot,
  PendingApproval as SharedPendingApproval,
  SourceReference as SharedSourceReference,
  ToolUsageEvent as SharedToolUsageEvent,
} from '@taskforceai/shared/types';

export type Message = SharedMessage;
export type ExecutionTrace = SharedExecutionTrace;
export type AgentStatus = AgentStatusSnapshot;
export type PendingApproval = SharedPendingApproval;
export type SourceReference = SharedSourceReference;
export type ToolUsageEvent = SharedToolUsageEvent;
