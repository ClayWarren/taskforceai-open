import type { SyncClient } from './client';
import type { SyncStorage } from '@taskforceai/persistence';

export interface SyncManagerConfig {
  storage: SyncStorage;
  syncClient: SyncClient;
  autoSyncInterval?: number; // Auto-sync every N milliseconds (0 = disabled)
  onSyncStart?: () => void;
  onSyncComplete?: (stats: SyncStats) => void;
  onSyncError?: (error: Error) => void;
  onConflict?: (conflicts: ConflictInfo[]) => void;
}

export interface SyncStats {
  duration: number;
  pulled: {
    conversations: number;
    messages: number;
    deletions: number;
  };
  pushed: {
    conversations: number;
    messages: number;
    deletions: number;
  };
  conflicts: number;
  errors: number;
}

export interface ConflictInfo {
  type: 'conversation' | 'message';
  id: string;
  localVersion: number;
  serverVersion: number;
  reason: string;
}

export enum SyncStatus {
  IDLE = 'idle',
  SYNCING = 'syncing',
  ERROR = 'error',
}
