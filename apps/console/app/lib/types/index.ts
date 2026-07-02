import type { Message as SharedMessage } from '@taskforceai/shared/chat/types';
import type {
  AgentStatusSnapshot,
  SourceReference as SharedSourceReference,
  ToolUsageEvent as SharedToolUsageEvent,
} from '@taskforceai/shared/types';

export type Message = SharedMessage;
export type AgentStatus = AgentStatusSnapshot;
export type SourceReference = SharedSourceReference;
export type ToolUsageEvent = SharedToolUsageEvent;
