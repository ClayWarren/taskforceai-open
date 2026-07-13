/**
 * SQLite Storage Adapter - Facade implementation delegating to specialized repositories.
 */
import { dbManager } from './database-manager';
import { ConversationRepository } from './repositories/ConversationRepository';
import { MessageRepository } from './repositories/MessageRepository';
import { SyncRepository } from './repositories/SyncRepository';
import { DeviceRepository } from './repositories/DeviceRepository';
import { SessionRepository } from './repositories/SessionRepository';
import { UserRepository } from './repositories/UserRepository';
import { clearAuthToken } from '../auth/token-store';
import type {
  StorageAdapter,
  StorageConversation,
  StorageMessage,
  PendingChange,
  StorageReadError
} from './storage-adapter';
import type { Result } from '@taskforceai/client-core/result';
import type { AuthenticatedUser, SessionData } from '@taskforceai/api-client/auth';

class SQLiteStorageAdapter implements StorageAdapter {
  private conversations = new ConversationRepository();
  private messages = new MessageRepository();
  private sync = new SyncRepository();
  private device = new DeviceRepository();
  private session = new SessionRepository();
  private user = new UserRepository();

  // Conversation methods
  getConversations(limit?: number, offset?: number): Promise<StorageConversation[]> {
    return this.conversations.getConversations(limit, offset);
  }
  getArchivedConversations(limit?: number, offset?: number): Promise<StorageConversation[]> {
    return this.conversations.getArchivedConversations(limit, offset);
  }
  getConversation(conversationId: string): Promise<Result<StorageConversation, StorageReadError>> {
    return this.conversations.getConversation(conversationId);
  }
  upsertConversation(conversation: StorageConversation): Promise<void> {
    return this.conversations.upsertConversation(conversation);
  }
  deleteConversation(conversationId: string): Promise<void> {
    return this.conversations.deleteConversation(conversationId);
  }
  archiveAllConversations(): Promise<void> {
    return this.conversations.archiveAllConversations();
  }
  deleteAllConversations(): Promise<void> {
    return this.conversations.deleteAllConversations();
  }
  replaceConversationId(oldId: string, newId: string): Promise<void> {
    return this.conversations.replaceConversationId(oldId, newId);
  }
  updateConversationMetadata(
    conversationId: string,
    updates: { updatedAt?: number; lastMessagePreview?: string | null; title?: string }
  ): Promise<void> {
    return this.conversations.updateConversationMetadata(conversationId, updates);
  }

  // Message methods
  getMessages(conversationId: string, limit?: number, offset?: number): Promise<StorageMessage[]> {
    return this.messages.getMessages(conversationId, limit, offset);
  }
  getMessage(messageId: string): Promise<Result<StorageMessage, StorageReadError>> {
    return this.messages.getMessage(messageId);
  }
  upsertMessage(message: StorageMessage): Promise<void> {
    return this.messages.upsertMessage(message);
  }
  deleteMessage(messageId: string): Promise<void> {
    return this.messages.deleteMessage(messageId);
  }

  // Sync methods
  getPendingChanges(): Promise<PendingChange[]> {
    return this.sync.getPendingChanges();
  }
  addPendingChange(change: PendingChange): Promise<void> {
    return this.sync.addPendingChange(change);
  }
  updatePendingChange(id: number, data: Record<string, unknown>): Promise<void> {
    return this.sync.updatePendingChange(id, data);
  }
  removePendingChange(id: number): Promise<void> {
    return this.sync.removePendingChange(id);
  }
  clearPendingChanges(): Promise<void> {
    return this.sync.clearPendingChanges();
  }
  updatePendingChangeData(id: number, data: unknown): Promise<void> {
    return this.sync.updatePendingChangeData(id, data);
  }
  getLastSyncVersion(): Promise<number> {
    return this.sync.getLastSyncVersion();
  }
  setLastSyncVersion(version: number): Promise<void> {
    return this.sync.setLastSyncVersion(version);
  }

  // Session methods
  getSession(): Promise<Result<SessionData>> {
    return this.session.getSession();
  }
  setSession(session: SessionData): Promise<Result<void>> {
    return this.session.setSession(session);
  }
  clearSession(): Promise<Result<void>> {
    return this.session.clearSession();
  }
  getToken(): Promise<Result<string>> {
    return this.session.getSession().then((result) => {
      if (result.ok) {
        return { ok: true, value: result.value.accessToken } as Result<string>;
      }
      return { ok: false, error: result.error } as Result<string>;
    });
  }

  // Profile methods
  loadProfile(): Promise<Result<AuthenticatedUser | null>> {
    return this.user.loadProfile();
  }
  saveProfile(user: AuthenticatedUser): Promise<Result<void>> {
    return this.user.saveProfile(user);
  }
  clearProfile(): Promise<Result<void>> {
    return this.user.clearProfile();
  }

  // Device methods
  getDeviceId(): Promise<string> {
    return this.device.getDeviceId();
  }
  setDeviceId(deviceId: string): Promise<void> {
    return this.device.setDeviceId(deviceId);
  }

  async clearChatData(): Promise<void> {
    const db = await dbManager.ensureRawDb();
    const existingTables = new Set(
      (await db.getAllAsync<{ name: string }>('SELECT name FROM sqlite_master WHERE type="table"')).map(
        (row) => row.name
      )
    );
    const tablesToClear = [
      'messages',
      'conversations',
      'pending_changes',
      'prompt_queue',
      'pending_prompts',
    ].filter((tableName) => existingTables.has(tableName));

    await db.execAsync('BEGIN IMMEDIATE;');
    try {
      await db.execAsync(tablesToClear.map((tableName) => `DELETE FROM ${tableName};`).join('\n'));
      await db.execAsync('COMMIT;');
    } catch (error) {
      await db.execAsync('ROLLBACK;');
      throw error;
    }
  }

  async clearAll(): Promise<void> {
    const db = await dbManager.ensureRawDb();
    const existingTables = new Set(
      (await db.getAllAsync<{ name: string }>('SELECT name FROM sqlite_master WHERE type="table"')).map(
        (row) => row.name
      )
    );
    const tablesToClear = [
      'conversations',
      'messages',
      'pending_changes',
      'prompt_queue',
      'pending_prompts',
      'auth_sessions',
      'user_profiles',
      'metadata',
    ].filter((tableName) => existingTables.has(tableName));

    await db.execAsync('BEGIN IMMEDIATE;');
    try {
      await db.execAsync(tablesToClear.map((tableName) => `DELETE FROM ${tableName};`).join('\n'));
      await db.execAsync('COMMIT;');
    } catch (error) {
      await db.execAsync('ROLLBACK;');
      throw error;
    }
    await Promise.all([this.setLastSyncVersion(0), clearAuthToken()]);
  }
}


export const sqliteStorage = new SQLiteStorageAdapter();
