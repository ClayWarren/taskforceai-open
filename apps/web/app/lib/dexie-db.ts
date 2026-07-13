import { logger } from './logger';
import type { AgentStatus, PendingApproval, SourceReference, ToolUsageEvent } from './types';
import Dexie, { Table } from 'dexie';

type MessageRole = 'user' | 'assistant' | 'system';

export interface LocalMessage {
  id?: number;
  messageId: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  isStreaming: boolean;
  isAgentStatus?: boolean; // True for messages that display the agent execution panel
  isLocalCommandOutput?: boolean; // True for local command output that should not show assistant actions
  elapsedSeconds?: number; // Time taken for agent orchestration (for completed agent status messages)
  createdAt: number;
  updatedAt: number;
  error?: string | null;
  sources?: SourceReference[];
  toolEvents?: ToolUsageEvent[];
  agentStatuses?: AgentStatus[]; // Agent statuses snapshot for completed orchestrations
  syncVersion: number;
  lastSyncedAt: number;
  deviceId?: string;
  isDeleted: boolean;
  trace_id?: string;
  pendingApproval?: PendingApproval;
}

export interface LocalConversation {
  id?: number;
  conversationId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastMessagePreview?: string | null;
  syncVersion: number;
  lastSyncedAt: number;
  deviceId?: string;
  isDeleted: boolean;
  isArchived?: boolean;
  trace_id?: string;
  pendingApproval?: PendingApproval;
}

export interface PendingPrompt {
  id?: number;
  conversationId: string;
  prompt: string;
  createdAt: number;
  status: 'queued' | 'pending' | 'failed';
  runPayload?: unknown;
}

class TaskForceDB extends Dexie {
  messages!: Table<LocalMessage>;
  conversations!: Table<LocalConversation>;
  pendingPrompts!: Table<PendingPrompt>;
  private readonly retentionMs = 7 * 24 * 60 * 60 * 1000; // 7 days
  private readonly maxToolEventSize = 8_000; // chars

  constructor() {
    super(
      'TaskForceDB',
      typeof indexedDB !== 'undefined' && typeof IDBKeyRange !== 'undefined'
        ? { indexedDB, IDBKeyRange }
        : undefined
    );

    this.version(5).stores({
      messages: '++id,&messageId,conversationId,createdAt,role,[conversationId+createdAt]',
      conversations: '++id,&conversationId,updatedAt,isDeleted',
      pendingPrompts: '++id,conversationId,status,createdAt',
    });
  }

  private lastTrimTime = 0;
  private readonly TRIM_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

  async trimOldAgentData(): Promise<void> {
    if (dexieUnavailable || !this.isOpen()) return;
    const now = Date.now();
    if (now - this.lastTrimTime < this.TRIM_INTERVAL_MS) return;

    const cutoff = now - this.retentionMs;
    await this.transaction('rw', this.messages, async () => {
      const stale = await this.messages
        .where('createdAt')
        .below(cutoff)
        .and((msg) => Boolean(msg.toolEvents?.length || msg.agentStatuses?.length))
        .primaryKeys();
      if (stale.length) {
        await this.messages.bulkDelete(stale);
      }
      // Truncate oversized toolEvent payloads, filtering first to avoid unnecessary writes
      await this.messages
        .filter((msg) => {
          return Boolean(
            msg.toolEvents?.some(
              (event) => event.resultPreview && event.resultPreview.length > this.maxToolEventSize
            )
          );
        })
        .modify((msg) => {
          if (msg.toolEvents) {
            msg.toolEvents = msg.toolEvents.map((event) => {
              if (event.resultPreview && event.resultPreview.length > this.maxToolEventSize) {
                return {
                  ...event,
                  resultPreview: `${event.resultPreview.slice(0, this.maxToolEventSize)}…`,
                };
              }
              return event;
            });
          }
        });
    });

    this.lastTrimTime = now;
  }
}

export const db = new TaskForceDB();

let dexieUnavailable = false;

/**
 * Ensures the Dexie database is opened. Returns false if IndexedDB is unavailable.
 */
export async function ensureDexieReady(): Promise<boolean> {
  if (dexieUnavailable) {
    return false;
  }

  if (typeof window === 'undefined') {
    // Server-side rendering should not attempt to use Dexie
    dexieUnavailable = true;
    return false;
  }

  if (typeof indexedDB === 'undefined' || typeof IDBKeyRange === 'undefined') {
    dexieUnavailable = true;
    logger.warn('[Dexie] IndexedDB is not supported in this environment. Local cache disabled.');
    return false;
  }

  if (db.isOpen()) {
    void db.trimOldAgentData().catch((error: unknown) => {
      logger.warn('[Dexie] trimOldAgentData failed', { error });
    });
    return true;
  }

  try {
    await db.open();
    void db.trimOldAgentData().catch((error: unknown) => {
      logger.warn('[Dexie] trimOldAgentData failed', { error });
    });
    return true;
  } catch (error) {
    logger.error('[Dexie] Failed to open database, attempting recovery', { error });
    let errorName = 'UnknownError';
    if (error instanceof Error) {
      errorName = error.name;
    } else if (typeof error === 'object' && error !== null && 'name' in error) {
      errorName = String((error as Record<string, unknown>)['name']);
    }

    if (errorName === 'VersionError') {
      dexieUnavailable = true;
      logger.warn('[Dexie] Local cache schema is newer than this app version; cache disabled.');
      return false;
    }

    if (errorName === 'OpenFailedError' || errorName === 'InvalidStateError') {
      try {
        await db.delete();
        await db.open();
        logger.info('[Dexie] Database reset after recovery attempt');
        return true;
      } catch (retryError) {
        logger.error('[Dexie] Recovery attempt failed', { error: retryError });
      }
    }

    dexieUnavailable = true;
    logger.warn('[Dexie] Disabling local cache – IndexedDB is not available.');
    return false;
  }
}

export function isDexieAvailable(): boolean {
  return !dexieUnavailable && db.isOpen();
}
