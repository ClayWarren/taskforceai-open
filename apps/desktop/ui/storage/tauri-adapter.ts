import {
  mapToStorageConversation as toStorageConversation,
  mapToStorageMessage as toStorageMessage,
} from '@taskforceai/persistence/chat-normalizers';
import { invokeTauri } from '../platform/bridge';
import { err, ok } from '@taskforceai/client-core/result';
import { storageNotFoundError, type StorageAdapter } from '@taskforceai/persistence';
import { logger } from '@taskforceai/web/app/lib/logger';
import {
  isRecord,
  toCompatRawMessage,
  toPendingChange,
  toRawConversation,
  toRawMessage,
  toRawPendingChange,
  type RawConversation,
  type RawMessage,
  type RawPendingChange,
} from './tauri-adapter-mappers';

type RawSyncStatus = {
  deviceId?: string | null;
  lastSyncVersion: number;
  configured?: boolean;
};
type RawSyncDevice = {
  deviceId: string;
  generated?: boolean;
};

const invokeStorage = async <T>(command: string, payload?: Record<string, unknown>): Promise<T> =>
  invokeTauri<T>(command, payload);

const normalizePagination = (limit?: number, offset?: number) => {
  const normalizedLimit =
    typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : null;
  const normalizedOffset =
    typeof offset === 'number' && Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;

  return { normalizedLimit, normalizedOffset };
};

const applyPagination = <T>(items: T[], limit: number | null, offset: number): T[] => {
  if (offset <= 0 && limit === null) {
    return items;
  }

  const start = Math.max(0, offset);
  if (limit === null) {
    return items.slice(start);
  }

  return items.slice(start, start + limit);
};

let pendingChangeLock = Promise.resolve();

const listPendingChangesRaw = async (): Promise<RawPendingChange[]> => {
  const result = await invokeStorage<RawPendingChange[] | { pendingChanges: RawPendingChange[] }>(
    'app_server_pending_change_list'
  );
  return Array.isArray(result) ? result : result.pendingChanges;
};

const serializePendingChange = <T>(task: () => Promise<T>): Promise<T> => {
  const result = pendingChangeLock.then(task);
  pendingChangeLock = result.catch((error) => {
    logger.warn('[tauri-storage] Pending change operation failed', { error });
  }) as Promise<void>;
  return result;
};

const mergePendingChangeDataPatch = async (
  id: number,
  patch: Record<string, unknown>
): Promise<Record<string, unknown>> => {
  const changes = await listPendingChangesRaw();
  const existing = changes.find((change) => Number(change['id']) === id);
  if (!existing || !isRecord(existing['data'])) {
    return patch;
  }
  return {
    ...existing['data'],
    ...patch,
  };
};

export const tauriStorage: StorageAdapter = {
  async getConversations(limit, offset) {
    const { normalizedLimit, normalizedOffset } = normalizePagination(limit, offset);
    const upstreamLimit = normalizedLimit === null ? null : normalizedLimit + normalizedOffset;

    const result = await invokeStorage<RawConversation[] | { conversations: RawConversation[] }>(
      'app_server_conversation_list',
      { limit: upstreamLimit }
    );
    const conversations = Array.isArray(result) ? result : result.conversations;

    const normalized = conversations.map(toStorageConversation);
    return applyPagination(normalized, normalizedLimit, normalizedOffset);
  },

  async getConversation(conversationId) {
    const conversation = await invokeStorage<RawConversation>('app_server_conversation_get', {
      conversationId,
    });
    return conversation
      ? ok(toStorageConversation(conversation))
      : err(storageNotFoundError('Conversation not found'));
  },

  async upsertConversation(conversation) {
    await invokeStorage<void>('app_server_conversation_upsert', {
      conversation: toRawConversation(conversation),
    });
  },

  async deleteConversation(conversationId: string) {
    await invokeStorage<void>('app_server_conversation_delete', {
      conversationId,
    });
  },

  async deleteAllConversations() {
    await invokeStorage<void>('app_server_conversation_delete_all');
  },

  async replaceConversationId(oldId: string, newId: string) {
    await invokeStorage<void>('app_server_conversation_replace_id', {
      oldId,
      newId,
    });
  },

  async getMessages(conversationId: string, limit?: number, offset?: number) {
    const { normalizedLimit, normalizedOffset } = normalizePagination(limit, offset);
    const result = await invokeStorage<RawMessage[] | { messages: RawMessage[] }>(
      'app_server_message_list',
      { conversationId }
    );
    const messages = Array.isArray(result) ? result : result.messages;
    const normalized = messages.map((message) => toStorageMessage(toCompatRawMessage(message)));
    return applyPagination(normalized, normalizedLimit, normalizedOffset);
  },

  async getMessage(messageId) {
    const message = await invokeStorage<RawMessage>('app_server_message_get', {
      messageId,
    });
    return message
      ? ok(toStorageMessage(toCompatRawMessage(message)))
      : err(storageNotFoundError('Message not found'));
  },

  async upsertMessage(message) {
    await invokeStorage<void>('app_server_message_upsert', {
      message: toRawMessage(message),
    });
  },

  async deleteMessage(messageId) {
    await invokeStorage<void>('app_server_message_delete', {
      messageId,
    });
  },

  async getPendingChanges() {
    const changes = await listPendingChangesRaw();
    return changes.map(toPendingChange);
  },

  async addPendingChange(change) {
    await invokeStorage<void>('app_server_pending_change_add', {
      change: toRawPendingChange(change),
    });
  },

  async updatePendingChange(id, data) {
    await serializePendingChange(async () => {
      const merged = await mergePendingChangeDataPatch(id, data);
      await invokeStorage<void>('app_server_pending_change_update_data', {
        id,
        data: merged,
      });
    });
  },

  async removePendingChange(id) {
    await invokeStorage<void>('app_server_pending_change_delete', { id });
  },

  async updatePendingChangeData(id, data) {
    await serializePendingChange(async () => {
      if (isRecord(data)) {
        const merged = await mergePendingChangeDataPatch(id, data);
        await invokeStorage<void>('app_server_pending_change_update_data', {
          id,
          data: merged,
        });
        return;
      }
      await invokeStorage<void>('app_server_pending_change_update_data', {
        id,
        data,
      });
    });
  },

  async clearPendingChanges() {
    await invokeStorage<void>('app_server_pending_change_clear');
  },

  async getLastSyncVersion() {
    const status = await invokeStorage<RawSyncStatus>('app_server_sync_status');
    return status.lastSyncVersion;
  },

  async setLastSyncVersion(version: number) {
    await invokeStorage<void>('app_server_sync_configure', {
      lastSyncVersion: version,
    });
  },

  async getDeviceId() {
    const result = await invokeStorage<RawSyncDevice | null>('app_server_sync_ensure_device');
    const deviceId = result?.deviceId;
    if (!deviceId) {
      throw new Error(
        'Desktop storage did not return a device ID. Restart the desktop app and verify storage permissions are enabled.'
      );
    }
    return deviceId;
  },

  async setDeviceId(deviceId: string) {
    await invokeStorage<void>('app_server_sync_configure', { deviceId });
  },

  async clearAll() {
    await invokeStorage<void>('app_server_metadata_clear_all');
  },
};
