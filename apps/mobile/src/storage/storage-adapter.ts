/**
 * Mobile copy of the storage adapter interfaces used on web/desktop.
 *
 * We keep the shape aligned with the shared contract but re-use the mobile
 * versions of SourceReference/ToolUsageEvent so the React Native code can
 * persist its own event formats without type conflicts.
 */
import { type Result } from '@taskforceai/shared/result';
import type { AuthenticatedUser, SessionData } from '@taskforceai/contracts/auth';
import type { 
  StorageConversation, 
  StorageMessage, 
  PendingChange,
  StorageAdapter as IBaseStorageAdapter,
  ConversationStorage as IConversationStore,
  MessageStorage as IMessageStore,
  PendingChangeStorage as ISyncStore
} from '@taskforceai/persistence';

export type { StorageConversation, StorageMessage, PendingChange, IConversationStore, IMessageStore, ISyncStore };

export interface ISessionStore {
  getSession(): Promise<Result<SessionData>>;
  setSession(session: SessionData): Promise<Result<void>>;
  clearSession(): Promise<Result<void>>;
}

export interface IUserProfileStore {
  loadProfile(): Promise<Result<AuthenticatedUser | null>>;
  saveProfile(user: AuthenticatedUser): Promise<Result<void>>;
  clearProfile(): Promise<Result<void>>;
}

export interface IDeviceStore {
  getDeviceId(): Promise<string>;
  setDeviceId(deviceId: string): Promise<void>;
}

export interface StorageAdapter
  extends IBaseStorageAdapter,
    ISessionStore,
    IUserProfileStore,
    IDeviceStore {
  clearAll(): Promise<void>;
  
  // Mobile specific additions not in base
  updateConversationMetadata(
    conversationId: string,
    updates: { updatedAt?: number; lastMessagePreview?: string | null; title?: string }
  ): Promise<void>;
}
