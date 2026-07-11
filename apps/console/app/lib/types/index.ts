import type { Message as SharedMessage } from '@taskforceai/client-core/chat/types';
import type {
  AgentStatusSnapshot,
  SourceReference as SharedSourceReference,
  ToolUsageEvent as SharedToolUsageEvent,
} from '@taskforceai/client-core/types';

export type Message = SharedMessage;
export type AgentStatus = AgentStatusSnapshot;
export type SourceReference = SharedSourceReference;
export type ToolUsageEvent = SharedToolUsageEvent;
