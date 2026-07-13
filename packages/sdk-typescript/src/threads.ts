/** Represents a conversation thread. */
export interface Thread {
  id: number;
  timestamp: string;
  user_input: string;
  result: string;
  execution_time: number;
  model: string;
  agent_count: number;
  sources: unknown[] | null;
  agentStatuses: unknown[] | null;
  toolEvents: unknown[] | null;
}

/** Represents a message within a thread. */
export interface ThreadMessage {
  id: number;
  thread_id: number;
  role: 'user' | 'assistant';
  content: string;
  message_id?: string;
  is_agent_status?: boolean;
  elapsed_seconds?: number;
  created_at?: string;
  error?: string;
  sources?: unknown;
  tool_events?: unknown;
  agent_statuses?: unknown;
  updated_at?: string;
  rating?: number;
}

/** Options for creating a thread. */
export interface CreateThreadOptions {
  title?: string;
  messages?: ThreadMessage[];
  metadata?: Record<string, unknown>;
}

/** Response containing a list of threads. */
export interface ThreadListResponse {
  conversations: Thread[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

/** Response containing messages from a thread. */
export interface ThreadMessagesResponse {
  messages: ThreadMessage[];
  truncated?: boolean;
}

/** Options for running a prompt in a thread. */
export interface ThreadRunOptions {
  prompt: string;
  modelId?: string;
  stream?: boolean;
  /** @deprecated The current Developer API does not accept nested thread-run options. */
  options?: Record<string, unknown>;
}

/** Response from running in a thread. */
export interface ThreadRunResponse {
  taskId: string;
  status: string;
}
