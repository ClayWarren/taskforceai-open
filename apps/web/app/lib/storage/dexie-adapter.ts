import { db, ensureDexieReady } from '@taskforceai/web/lib/dexie-db';

import { type Result, err } from '@taskforceai/shared/result';
import {
  clearSyncMetadata,
  getLastSyncVersionFromStorage,
  getOrCreateDeviceId,
  setDeviceIdInStorage,
  setLastSyncVersionInStorage,
} from './dexie-metadata';
import { DexieOperationExecutor } from './dexie-executor';
import type {
  PendingChange,
  StorageAdapter,
  StorageConversation,
  StorageMessage,
} from '@taskforceai/persistence';
import {
  archiveAllDexieConversations,
  deleteDexieConversation,
  deleteAllDexieConversations,
  getDexieConversation,
  listArchivedDexieConversations,
  listDexieConversations,
  replaceDexieConversationId,
  upsertDexieConversation,
} from './dexie-conversations';
import {
  deleteDexieMessage,
  getDexieMessage,
  listDexieMessages,
  upsertDexieMessage,
} from './dexie-messages';
import {
  createPendingChangeFromPrompt,
  createPendingPromptInsert,
  createPendingPromptUpdate,
  toPendingStatus,
} from './dexie-pending-changes';

export class DexieStorageAdapter implements StorageAdapter {
  private readonly executor = new DexieOperationExecutor();

  private async executeWhenReady<T>(
    fallback: T,
    operation: string,
    fn: () => Promise<T>
  ): Promise<T> {
    if (!(await ensureDexieReady())) return fallback;
    return this.executor.execute(operation, fn);
  }

  private async executeVoidWhenReady(operation: string, fn: () => Promise<void>): Promise<void> {
    if (!(await ensureDexieReady())) return;
    await this.executor.execute(operation, fn);
  }

  async getConversations(limit = 20, offset = 0): Promise<StorageConversation[]> {
    return this.executeWhenReady([], 'getConversations', () =>
      listDexieConversations(limit, offset)
    );
  }

  async getArchivedConversations(limit = 100, offset = 0): Promise<StorageConversation[]> {
    return this.executeWhenReady([], 'getArchivedConversations', () =>
      listArchivedDexieConversations(limit, offset)
    );
  }

  async getConversation(conversationId: string): Promise<Result<StorageConversation>> {
    return this.executeWhenReady(err(new Error('Dexie not ready')), 'getConversation', () =>
      getDexieConversation(conversationId)
    );
  }

  async upsertConversation(conversation: StorageConversation): Promise<void> {
    await this.executeVoidWhenReady('upsertConversation', () =>
      upsertDexieConversation(conversation)
    );
  }

  async deleteConversation(conversationId: string): Promise<void> {
    await this.executeVoidWhenReady('deleteConversation', () =>
      deleteDexieConversation(conversationId)
    );
  }

  async archiveAllConversations(): Promise<void> {
    await this.executeVoidWhenReady('archiveAllConversations', () =>
      archiveAllDexieConversations()
    );
  }

  async deleteAllConversations(): Promise<void> {
    await this.executeVoidWhenReady('deleteAllConversations', () => deleteAllDexieConversations());
  }

  async replaceConversationId(oldId: string, newId: string): Promise<void> {
    await this.executeVoidWhenReady('replaceConversationId', () =>
      replaceDexieConversationId(oldId, newId)
    );
  }

  async getMessages(
    conversationId: string,
    limit?: number,
    offset?: number
  ): Promise<StorageMessage[]> {
    return this.executeWhenReady([], 'getMessages', () =>
      listDexieMessages(conversationId, limit, offset)
    );
  }

  async getMessage(messageId: string): Promise<Result<StorageMessage>> {
    return this.executeWhenReady(err(new Error('Dexie not ready')), 'getMessage', () =>
      getDexieMessage(messageId)
    );
  }

  async upsertMessage(message: StorageMessage): Promise<void> {
    await this.executeVoidWhenReady('upsertMessage', () => upsertDexieMessage(message));
  }

  async deleteMessage(messageId: string): Promise<void> {
    await this.executeVoidWhenReady('deleteMessage', () => deleteDexieMessage(messageId));
  }

  async getPendingChanges(): Promise<PendingChange[]> {
    return this.executeWhenReady([], 'getPendingChanges', async () => {
      const prompts = await db.pendingPrompts.toArray();
      return prompts.map(createPendingChangeFromPrompt);
    });
  }

  async addPendingChange(change: PendingChange): Promise<void> {
    if (
      (change.type !== 'prompt' && change.type !== 'conversation') ||
      change.operation !== 'create'
    ) {
      return;
    }
    await this.executeVoidWhenReady('addPendingChange', async () => {
      await db.pendingPrompts.add(createPendingPromptInsert(change));
    });
  }

  async updatePendingChange(id: number, data: Record<string, unknown>): Promise<void> {
    await this.executeVoidWhenReady('updatePendingChange', async () => {
      const status = toPendingStatus(data['status']);
      if (status) {
        await db.pendingPrompts.update(id, { status });
      }
    });
  }

  async removePendingChange(id: number): Promise<void> {
    await this.executeVoidWhenReady('removePendingChange', async () => {
      await db.pendingPrompts.delete(id);
    });
  }

  async updatePendingChangeData(id: number, data: unknown): Promise<void> {
    await this.executeVoidWhenReady('updatePendingChangeData', async () => {
      const payload = createPendingPromptUpdate(data);
      if (!payload) {
        return;
      }
      await db.pendingPrompts.update(id, payload);
    });
  }

  async clearPendingChanges(): Promise<void> {
    await this.executeVoidWhenReady('clearPendingChanges', async () => {
      await db.pendingPrompts.clear();
    });
  }

  async getLastSyncVersion(): Promise<number> {
    return getLastSyncVersionFromStorage();
  }

  async setLastSyncVersion(version: number): Promise<void> {
    await setLastSyncVersionInStorage(version);
  }

  async getDeviceId(): Promise<string> {
    return getOrCreateDeviceId();
  }

  async setDeviceId(deviceId: string): Promise<void> {
    await setDeviceIdInStorage(deviceId);
  }

  async clearAll(): Promise<void> {
    const ready = await ensureDexieReady();
    if (!ready) {
      throw new Error('Dexie not ready');
    }
    await this.executor.execute('clearAll', async () => {
      await db.conversations.clear();
      await db.messages.clear();
      await db.pendingPrompts.clear();
      await clearSyncMetadata();
    });
  }
}

export const dexieStorage = new DexieStorageAdapter();
