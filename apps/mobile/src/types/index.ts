/**
 * Shared types for mobile app
 */

import type {
  AgentStatusSnapshot,
  SourceReference as SharedSourceReference,
  ToolUsageEvent as SharedToolUsageEvent,
} from '@taskforceai/shared/types';
import type { Message as SharedMessage } from '@taskforceai/shared/chat/types';

export type SourceReference = SharedSourceReference;

export type ToolUsageEvent = SharedToolUsageEvent;

export type AgentStatus = AgentStatusSnapshot;

export type Message = SharedMessage;
