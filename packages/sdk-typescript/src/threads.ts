/** Represents a conversation thread. */
export interface Thread {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
}

/** Represents a message within a thread. */
export interface ThreadMessage {
  id: number;
  thread_id: number;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

/** Options for creating a thread. */
export interface CreateThreadOptions {
  title?: string;
  messages?: ThreadMessage[];
  metadata?: Record<string, unknown>;
}

/** Response containing a list of threads. */
export interface ThreadListResponse {
  threads: Thread[];
  total: number;
}

/** Response containing messages from a thread. */
export interface ThreadMessagesResponse {
  messages: ThreadMessage[];
  total: number;
}

/** Options for running a prompt in a thread. */
export interface ThreadRunOptions {
  prompt: string;
  modelId?: string;
  options?: Record<string, unknown>;
}

/** Response from running in a thread. */
export interface ThreadRunResponse {
  task_id: string;
  thread_id: number;
  message_id: number;
}
