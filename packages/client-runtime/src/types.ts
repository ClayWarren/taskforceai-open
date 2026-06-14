import type { RunRequest } from '@taskforceai/contracts/contracts';
import type { MessageRole } from '@taskforceai/shared/chat/types';
import type { Result } from '@taskforceai/shared/result';
import type {
  AgentStatusSnapshot,
  PendingApproval as SharedPendingApproval,
  SourceReference as SharedSourceReference,
  ToolUsageEvent as SharedToolUsageEvent,
} from '@taskforceai/shared/types';

export type AgentStatus = AgentStatusSnapshot;
export type PendingApproval = SharedPendingApproval;
export type SourceReference = SharedSourceReference;
export type ToolUsageEvent = SharedToolUsageEvent;

export interface ConversationRecord {
  conversationId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastMessagePreview: string | null;
  isArchived?: boolean;
}

export interface MessageRecord {
  messageId: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  isStreaming: boolean;
  isAgentStatus?: boolean;
  isLocalCommandOutput?: boolean;
  elapsedSeconds?: number;
  createdAt: number;
  updatedAt: number;
  error?: string | null;
  sources?: SourceReference[];
  toolEvents?: ToolUsageEvent[];
  agentStatuses?: AgentStatus[];
  trace_id?: string;
  pendingApproval?: unknown;
}

export interface PendingPromptRecord {
  id?: number;
  conversationId: string;
  prompt: string;
  createdAt: number;
  status: 'queued' | 'pending' | 'failed';
  runPayload?:
    | RunRequest
    | { modelId?: string; attachment_ids?: string[]; attachmentIds?: string[] };
}

export interface UpsertMessageParams {
  conversationId: string;
  messageId: string;
  role: MessageRole;
  content: string;
  isStreaming: boolean;
  isAgentStatus?: boolean;
  isLocalCommandOutput?: boolean;
  elapsedSeconds?: number;
  error?: string | null;
  sources?: SourceReference[];
  toolEvents?: ToolUsageEvent[];
  agentStatuses?: AgentStatus[];
  trace_id?: string;
  pendingApproval?: unknown;
  createdAt?: number;
  updatedAt?: number;
}

export type ConversationStoreEvent =
  | { type: 'conversations-changed'; conversationId?: string }
  | { type: 'messages-changed'; conversationId: string }
  | { type: 'pending-prompts-changed'; conversationId?: string };

export type ConversationStoreSubscriber = (event: ConversationStoreEvent) => void;

export interface ConversationStore {
  ensureConversation(conversationId: string, title: string): Promise<void>;
  renameConversation(conversationId: string, title: string): Promise<void>;
  archiveConversation?(conversationId: string): Promise<void>;
  restoreConversation?(conversationId: string): Promise<void>;
  getConversation(
    conversationId: string
  ): Promise<Result<ConversationRecord, { kind: 'not_found' | 'storage'; message: string }>>;
  getConversationMessages(
    conversationId: string,
    limit?: number,
    offset?: number
  ): Promise<MessageRecord[]>;
  upsertMessage(params: UpsertMessageParams): Promise<void>;
  listConversations(limit?: number, offset?: number): Promise<ConversationRecord[]>;
  listArchivedConversations?(limit?: number, offset?: number): Promise<ConversationRecord[]>;
  clearConversation(conversationId: string): Promise<void>;
  archiveAllConversations?(): Promise<void>;
  deleteAllConversations?(): Promise<void>;
  replaceConversationId?(oldId: string, newId: string): Promise<void>;
  enqueuePrompt(conversationId: string, prompt: string, runPayload?: RunRequest): Promise<void>;
  updatePromptStatus(id: number, status: PendingPromptRecord['status']): Promise<void>;
  removePrompt(id: number): Promise<void>;
  listPendingPrompts(): Promise<PendingPromptRecord[]>;
  subscribe(listener: ConversationStoreSubscriber): () => void;
}

export interface KeyValueStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}
