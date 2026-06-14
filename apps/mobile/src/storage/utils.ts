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

const RoleSchema = z.enum(['user', 'assistant', 'system']);
const MessageMetadataSchema = z.object({
  traceId: z.string().optional(),
  isLocalCommandOutput: z.boolean().optional(),
});

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
  const roleResult = RoleSchema.safeParse(row.role);
  const role = roleResult.success ? roleResult.data : 'user';
  const metadata = safeParseJson(row.metadata, MessageMetadataSchema, {});

  const result: StorageMessage = {
    messageId: row.messageId,
    conversationId: row.conversationId,
    role,
    content: row.content,
    isStreaming: fromBooleanFlag(row.isStreaming),
    isAgentStatus: fromBooleanFlag(row.isAgentStatus),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    sources: safeParseJson(row.sources, z.array(sourceReferenceSchema), []),
    toolEvents: safeParseJson(row.toolEvents, z.array(toolUsageEventSchema), []),
    agentStatuses: safeParseJson(row.agentStatuses, z.array(agentStatusSchema), []),
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
