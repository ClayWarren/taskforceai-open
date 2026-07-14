/**
 * Shared types for mobile app
 */

import type {
  AgentStatusSnapshot,
  SourceReference as SharedSourceReference,
  ToolUsageEvent as SharedToolUsageEvent,
} from '@taskforceai/client-core/types';
import type { Message as SharedMessage } from '@taskforceai/client-core/chat/types';

export type SourceReference = SharedSourceReference;

export type ToolUsageEvent = SharedToolUsageEvent;

export type AgentStatus = AgentStatusSnapshot;

export type Message = SharedMessage;
