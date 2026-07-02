import { z } from 'zod';
import {
  fromBooleanFlag,
  safeParseJson,
  serializeError,
} from '@taskforceai/shared/storage/value-utils';
import { err, type Result } from '@taskforceai/shared/result';
import { mobileLogger } from '../logger';
import {
  agentStatusSchema,
  sourceReferenceSchema,
  toolUsageEventSchema,
} from '@taskforceai/shared/validation';
import type { ConversationRow, MessageRow } from './schema';
import type { StorageConversation, StorageMessage } from './storage-adapter';

export {
  safeParseJson,
  serializeJson,
  toBooleanFlag,
} from '@taskforceai/shared/storage/value-utils';

const MessageMetadataSchema = z.object({
  traceId: z.string().optional(),
  isLocalCommandOutput: z.boolean().optional(),
});
const SourceReferenceArraySchema = z.array(sourceReferenceSchema);
const ToolUsageEventArraySchema = z.array(toolUsageEventSchema);
const AgentStatusArraySchema = z.array(agentStatusSchema);
type MessageRole = StorageMessage['role'];

const parseMessageRole = (role: string): MessageRole => {
  switch (role) {
    case 'assistant':
    case 'system':
    case 'user':
      return role;
    default:
      return 'user';
  }
};

const parseJsonArrayField = <T>(value: string | null | undefined, schema: z.ZodType<T[]>): T[] => {
  if (!value || value === '[]') {
    return [];
  }
  return safeParseJson(value, schema, []);
};

const parseMessageMetadata = (value: string | null | undefined) => {
  if (!value || value === '{}') {
    return {};
  }
  return safeParseJson(value, MessageMetadataSchema, {});
};

export async function withRepoError<T>(
  label: string,
  fn: () => Promise<T>,
  ctx?: Record<string, unknown>
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    mobileLogger.error(`${label} failed`, { ...serializeError(error), ...ctx });
    throw error;
  }
}

export async function withRepoResult<T>(
  label: string,
  fn: () => Promise<Result<T>>,
  ctx?: Record<string, unknown>
): Promise<Result<T>> {
  try {
    return await fn();
  } catch (error) {
    mobileLogger.error(`${label} failed`, { ...serializeError(error), ...ctx });
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

export const mapConversationRow = (row: ConversationRow): StorageConversation => {
  const result: StorageConversation = {
    conversationId: row.conversationId,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastMessagePreview: row.lastMessagePreview ?? null,
    syncVersion: row.syncVersion,
    lastSyncedAt: row.lastSyncedAt,
    isDeleted: fromBooleanFlag(row.isDeleted),
    isArchived: fromBooleanFlag(row.isArchived),
  };
  if (row.id) result.id = row.id;
  if (row.deviceId) result.deviceId = row.deviceId;
  return result;
};

export const mapMessageRow = (row: MessageRow): StorageMessage => {
  const role = parseMessageRole(row.role);
  const metadata = parseMessageMetadata(row.metadata);

  const result: StorageMessage = {
    messageId: row.messageId,
    conversationId: row.conversationId,
    role,
    content: row.content,
    isStreaming: fromBooleanFlag(row.isStreaming),
    isAgentStatus: fromBooleanFlag(row.isAgentStatus),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    sources: parseJsonArrayField(row.sources, SourceReferenceArraySchema),
    toolEvents: parseJsonArrayField(row.toolEvents, ToolUsageEventArraySchema),
    agentStatuses: parseJsonArrayField(row.agentStatuses, AgentStatusArraySchema),
    syncVersion: row.syncVersion,
    lastSyncedAt: row.lastSyncedAt,
    isDeleted: fromBooleanFlag(row.isDeleted),
  };

  if (row.id) result.id = row.id;
  if (row.elapsedSeconds !== null && row.elapsedSeconds !== undefined) {
    result.elapsedSeconds = row.elapsedSeconds;
  }
  if (row.error) result.error = row.error;
  if (row.deviceId) result.deviceId = row.deviceId;
  if (metadata.traceId !== undefined) result.traceId = metadata.traceId;
  if (metadata.isLocalCommandOutput !== undefined) {
    result.isLocalCommandOutput = metadata.isLocalCommandOutput;
  }

  return result;
};
