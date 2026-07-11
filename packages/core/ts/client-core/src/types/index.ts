/**
 * Shared type definitions for cross-platform use
 */
import { type Result } from '../result';

// Re-export branded types for convenience
export type { Brand } from './branded';

export {
  type ConversationId,
  type ServerConversationId,
  type MessageId,
  type UserId,
  type AgentId,
  type DeviceId,
  type TaskId,
  type ApiKeyId,
  type SessionId,
  isValidIdString,
  isValidServerId,
  unwrapId,
  unwrapServerId,
  conversationIdSchema,
  serverConversationIdSchema,
  messageIdSchema,
  userIdSchema,
  agentIdSchema,
  deviceIdSchema,
  taskIdSchema,
  apiKeyIdSchema,
  sessionIdSchema,
} from './branded';

// Agent and task types
export interface AgentStatus {
  agentId: string;
  status: 'idle' | 'running' | 'completed' | 'failed';
  progress: number;
  message?: string;
  result?: string;
  error?: string;
}

export interface TaskProgress {
  taskId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  agents: AgentStatus[];
  synthesisStatus?: 'pending' | 'running' | 'completed' | 'failed';
  finalResult?: string;
  error?: string;
}

// UI State types
export interface ThemeState {
  mode: 'light' | 'dark';
  primaryColor?: string;
  accentColor?: string;
}

export interface UserPreferences {
  theme: ThemeState['mode'];
  notificationsEnabled: boolean;
  autoSave: boolean;
}

// Form validation types
export type ValidationRule<T> = (value: T) => string | undefined;

export interface FormField<T> {
  value: T;
  error?: string;
  touched: boolean;
  dirty: boolean;
}

// Utility types
export type Nullable<T> = T | null;
export type Optional<T> = T | undefined;
export type AsyncResult<T, E = Error> = Promise<{ data?: T; error?: E }>;

// Event types for SSE
export interface ServerSentEvent<T = unknown> {
  type: string;
  data: T;
  id?: string;
  retry?: number;
}

export interface AgentProgressEvent {
  type: 'agent_progress';
  agent_id: string;
  status: AgentStatus['status'];
  progress: number;
  message?: string;
  result?: string;
}

export interface SynthesisProgressEvent {
  type: 'synthesis_progress';
  status: 'running' | 'completed' | 'failed';
  message?: string;
  result?: string;
}

export interface ErrorEvent {
  type: 'error';
  message: string;
  details?: unknown;
}

export interface CompleteEvent {
  type: 'complete';
  result: string;
}

export type StreamEvent = AgentProgressEvent | SynthesisProgressEvent | ErrorEvent | CompleteEvent;

// Configuration types
export interface AppConfig {
  apiUrl: string;
  wsUrl?: string;
  environment: 'development' | 'staging' | 'production';
  features: {
    payments: boolean;
    admin: boolean;
    metrics: boolean;
  };
}

// Storage types
export interface StorageAdapter {
  getItem(key: string): Promise<Result<string>>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  clear(): Promise<void>;
}

// Shared message/telemetry types (UI + API payloads).
export interface SourceReference {
  url: string;
  title?: string;
  snippet?: string;
}

export interface GeneratedFileArtifact {
  artifactId?: string;
  filename: string;
  filepath?: string;
  mimeType?: string;
  bytes?: number;
  fileId?: string;
  downloadUrl?: string;
}

export interface ToolUsageEvent {
  invocationId?: string;
  timestamp?: string;
  agentId?: number;
  agentLabel: string;
  toolName: string;
  arguments: unknown;
  status?: string;
  success: boolean;
  durationMs: number;
  resultPreview?: string;
  error?: string;
  image_base64?: string;
  sources?: SourceReference[];
  generatedFile?: GeneratedFileArtifact;
}

export interface AgentStatusSnapshot {
  status: string;
  agent_id?: number;
  progress?: number;
  result?: string;
  reasoning?: string;
  model?: string;
}

export interface PendingApproval {
  approvalId?: string;
  permission: string;
  agentName: string;
  patterns: string[];
  metadata: Record<string, unknown>;
}

export type { PendingApproval as PendingApprovalType };

/**
 * Token usage record for tracking LLM costs
 */
export interface TokenUsageRecord {
  model: string;
  stage: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Agent result from orchestration
 */
export interface AgentResult {
  success: boolean;
  response?: string;
  error?: string;
  tokenUsage?: TokenUsageRecord[];
  toolUsage?: ToolUsageEvent[];
}

/**
 * Telemetry interface for recording usage
 */
export interface ITelemetry {
  recordTokenUsage(record: TokenUsageRecord): void;
  recordToolUsage(event: ToolUsageEvent): void;
}
