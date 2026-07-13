import {
  mapToStorageConversation as toStorageConversation,
  mapToStorageMessage as toStorageMessage,
} from '@taskforceai/persistence/chat-normalizers';
import type { PendingChange, StorageConversation, StorageMessage } from '@taskforceai/persistence';

import { logger } from '../logger';

export type RawConversation = Parameters<typeof toStorageConversation>[0];
export type RawMessage = Parameters<typeof toStorageMessage>[0];
export type RawPendingChange = Record<string, unknown>;

const legacyParseWarningKeys = new Set<string>();

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const toRawConversation = (conversation: StorageConversation): RawConversation => {
  const raw: RawConversation = {
    conversationId: conversation.conversationId,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    lastMessagePreview: conversation.lastMessagePreview ?? null,
    syncVersion: conversation.syncVersion,
    lastSyncedAt: conversation.lastSyncedAt,
    isDeleted: conversation.isDeleted,
  };
  if (conversation.isArchived === true) {
    raw.isArchived = true;
  }
  if (conversation.id !== undefined) {
    raw.id = conversation.id;
  }
  if (conversation.deviceId !== undefined) {
    raw.deviceId = conversation.deviceId;
  }
  return raw;
};

export const toRawMessage = (message: StorageMessage): RawMessage => {
  const raw: RawMessage = {
    messageId: message.messageId,
    conversationId: message.conversationId,
    role: message.role,
    content: message.content,
    isStreaming: message.isStreaming,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    syncVersion: message.syncVersion,
    lastSyncedAt: message.lastSyncedAt,
    isDeleted: message.isDeleted,
  };
  if (message.id !== undefined) {
    raw.id = message.id;
  }
  if (message.isAgentStatus !== undefined) {
    raw.isAgentStatus = message.isAgentStatus;
  }
  if (message.isLocalCommandOutput !== undefined) {
    raw.isLocalCommandOutput = message.isLocalCommandOutput;
  }
  if (message.elapsedSeconds !== undefined) {
    raw.elapsedSeconds = message.elapsedSeconds;
  }
  if (message.error !== undefined) {
    raw.error = message.error;
  }
  raw.sources = message.sources ?? [];
  raw.toolEvents = message.toolEvents ?? [];
  raw.agentStatuses = message.agentStatuses ?? [];
  if (message.deviceId !== undefined) {
    raw.deviceId = message.deviceId;
  }
  if (message.traceId !== undefined) {
    raw.traceId = message.traceId;
  }
  return raw;
};

export const toRawPendingChange = (change: PendingChange): RawPendingChange => {
  const raw: RawPendingChange = {
    type: change.type,
    entityId: change.entityId,
    operation: change.operation,
    data: change.data,
    createdAt: change.createdAt,
  };
  if (change.id !== undefined) {
    raw['id'] = change.id;
  }
  return raw;
};

export const toPendingChange = (record: RawPendingChange): PendingChange => {
  const change: PendingChange = {
    type: record['type'] as PendingChange['type'],
    entityId: record['entityId'] as string,
    operation: record['operation'] as PendingChange['operation'],
    data: record['data'],
    createdAt: record['createdAt'] as number,
  };
  if (record['id'] !== undefined && record['id'] !== null) {
    change.id = record['id'] as number;
  }
  return change;
};

const parseLegacyArrayField = (fieldName: string, value: unknown): unknown => {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // The warning below records the malformed legacy value once.
  }
  const warningKey = `${fieldName}:${value.slice(0, 64)}`;
  if (!legacyParseWarningKeys.has(warningKey)) {
    legacyParseWarningKeys.add(warningKey);
    logger.warn('Failed to parse legacy array field from desktop storage', {
      fieldName,
      preview: value.slice(0, 120),
    });
  }
  return value;
};

export const toCompatRawMessage = (message: RawMessage): RawMessage => ({
  ...message,
  sources: parseLegacyArrayField('sources', message.sources),
  toolEvents: parseLegacyArrayField('toolEvents', message.toolEvents),
  agentStatuses: parseLegacyArrayField('agentStatuses', message.agentStatuses),
});
