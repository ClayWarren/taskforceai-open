import type { MessageRole } from '@taskforceai/shared/chat/types';
import type { SourceReference, ToolUsageEvent } from '@taskforceai/shared/types';
import type { StorageConversation, StorageMessage } from './storage-adapter';

const MESSAGE_PREVIEW_LENGTH = 240;

type AgentStatusSnapshot = NonNullable<StorageMessage['agentStatuses']>[number];

export const createPreview = (content: string): string => {
  const trimmed = content.trim();
  if (trimmed.length <= MESSAGE_PREVIEW_LENGTH) return trimmed;
  return `${trimmed.slice(0, MESSAGE_PREVIEW_LENGTH)}…`;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';

const isSourceReference = (value: unknown): value is SourceReference => {
  if (!isRecord(value) || typeof value['url'] !== 'string') {
    return false;
  }
  if (value['title'] !== undefined && typeof value['title'] !== 'string') {
    return false;
  }
  if (value['snippet'] !== undefined && typeof value['snippet'] !== 'string') {
    return false;
  }
  return true;
};

const isToolUsageEvent = (value: unknown): value is ToolUsageEvent => {
  if (!isRecord(value)) return false;
  if (value['agentId'] !== undefined && typeof value['agentId'] !== 'number') return false;
  if (typeof value['agentLabel'] !== 'string') return false;
  if (typeof value['toolName'] !== 'string') return false;
  if (typeof value['success'] !== 'boolean') return false;
  if (typeof value['durationMs'] !== 'number') return false;
  if (value['timestamp'] !== undefined && typeof value['timestamp'] !== 'string') return false;

  if (value['resultPreview'] !== undefined && typeof value['resultPreview'] !== 'string') {
    return false;
  }
  if (value['error'] !== undefined && typeof value['error'] !== 'string') {
    return false;
  }
  if (value['image_base64'] !== undefined && typeof value['image_base64'] !== 'string') {
    return false;
  }
  return true;
};

const isAgentStatusSnapshot = (value: unknown): value is AgentStatusSnapshot => {
  if (!isRecord(value) || typeof value['status'] !== 'string') {
    return false;
  }
  if (value['agent_id'] !== undefined && typeof value['agent_id'] !== 'number') {
    return false;
  }
  if (value['progress'] !== undefined && typeof value['progress'] !== 'number') {
    return false;
  }
  if (value['result'] !== undefined && typeof value['result'] !== 'string') {
    return false;
  }
  if (value['reasoning'] !== undefined && typeof value['reasoning'] !== 'string') {
    return false;
  }
  if (value['model'] !== undefined && typeof value['model'] !== 'string') {
    return false;
  }
  return true;
};

export const normalizeSourceReferences = (value: unknown): SourceReference[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isSourceReference).map((item) => {
    const normalized: SourceReference = { url: item.url };
    if (item.title !== undefined) normalized.title = item.title;
    if (item.snippet !== undefined) normalized.snippet = item.snippet;
    return normalized;
  });
};

export const normalizeToolEvents = (value: unknown): ToolUsageEvent[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isToolUsageEvent).map((item) => {
    const normalized: ToolUsageEvent = {
      agentLabel: item.agentLabel,
      toolName: item.toolName,
      success: item.success,
      durationMs: item.durationMs,
      arguments: item.arguments ?? {},
    };
    if (item.agentId !== undefined) normalized.agentId = item.agentId;
    if (item.timestamp !== undefined) normalized.timestamp = item.timestamp;
    if (item.resultPreview !== undefined) normalized.resultPreview = item.resultPreview;
    if (item.error !== undefined) normalized.error = item.error;
    if (item.image_base64 !== undefined) normalized.image_base64 = item.image_base64;
    if (Array.isArray(item.sources)) normalized.sources = normalizeSourceReferences(item.sources);
    return normalized;
  });
};

export const normalizeAgentStatuses = (value: unknown): AgentStatusSnapshot[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isAgentStatusSnapshot).map((item) => {
    const normalized: AgentStatusSnapshot = { status: item.status };
    if (item.agent_id !== undefined) normalized.agent_id = item.agent_id;
    if (item.progress !== undefined) normalized.progress = item.progress;
    if (item.result !== undefined) normalized.result = item.result;
    if (item.reasoning !== undefined) normalized.reasoning = item.reasoning;
    if (item.model !== undefined) normalized.model = item.model;
    return normalized;
  });
};

export function mapToStorageConversation(conv: {
  id?: number | null;
  conversationId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastMessagePreview?: string | null;
  syncVersion?: number | null;
  lastSyncedAt?: number | null;
  deviceId?: string | null;
  isDeleted?: boolean | null;
  isArchived?: boolean | null;
  is_archived?: boolean | null;
}): StorageConversation {
  const result: StorageConversation = {
    conversationId: conv.conversationId,
    title: conv.title,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
    lastMessagePreview: conv.lastMessagePreview ?? null,
    syncVersion: conv.syncVersion ?? 0,
    lastSyncedAt: conv.lastSyncedAt ?? 0,
    isDeleted: conv.isDeleted ?? false,
  };
  if (conv.id != null) {
    result.id = conv.id;
  }
  if (conv.deviceId != null) {
    result.deviceId = conv.deviceId;
  }
  if (conv.isArchived === true || conv.is_archived === true) {
    result.isArchived = true;
  }
  return result;
}

export function mapToStorageMessage(msg: {
  id?: number | null;
  messageId: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  isStreaming: boolean;
  isAgentStatus?: boolean | null;
  isLocalCommandOutput?: boolean | null;
  elapsedSeconds?: number | null;
  createdAt: number;
  updatedAt: number;
  error?: string | null;
  sources?: unknown;
  toolEvents?: unknown;
  agentStatuses?: unknown;
  traceId?: string | null;
  trace_id?: string | null;
  syncVersion?: number | null;
  lastSyncedAt?: number | null;
  deviceId?: string | null;
  isDeleted?: boolean | null;
}): StorageMessage {
  const result: StorageMessage = {
    messageId: msg.messageId,
    conversationId: msg.conversationId,
    role: msg.role,
    content: msg.content,
    isStreaming: msg.isStreaming,
    createdAt: msg.createdAt,
    updatedAt: msg.updatedAt,
    sources: normalizeSourceReferences(msg.sources),
    toolEvents: normalizeToolEvents(msg.toolEvents),
    agentStatuses: normalizeAgentStatuses(msg.agentStatuses),
    syncVersion: msg.syncVersion ?? 0,
    lastSyncedAt: msg.lastSyncedAt ?? 0,
    isDeleted: msg.isDeleted ?? false,
  };

  if (msg.id != null) {
    result.id = msg.id;
  }
  if (msg.isAgentStatus != null) {
    result.isAgentStatus = msg.isAgentStatus;
  }
  if (msg.isLocalCommandOutput != null) {
    result.isLocalCommandOutput = msg.isLocalCommandOutput;
  }
  if (msg.elapsedSeconds != null) {
    result.elapsedSeconds = msg.elapsedSeconds;
  }
  if (msg.error != null) {
    result.error = msg.error;
  }
  if (msg.deviceId != null) {
    result.deviceId = msg.deviceId;
  }
  const traceId = msg.traceId ?? msg.trace_id;
  if (traceId != null) {
    result.traceId = traceId;
  }

  return result;
}
