import { describe, expect, it, vi, beforeEach } from 'bun:test';

let mockSyncManagerInstance: { sync: ReturnType<typeof vi.fn> };

vi.mock('@taskforceai/sync-client', () => ({
  createHttpSyncClient: vi.fn(() => ({})),
  SyncManager: vi.fn().mockImplementation(() => {
    mockSyncManagerInstance = {
      sync: vi.fn().mockResolvedValue(undefined),
    };
    return mockSyncManagerInstance;
  }),
}));

vi.mock('./dexie-adapter', () => ({
  dexieStorage: {},
}));

import { getSyncManager, triggerSync } from './chat-sync';

describe('chat-sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getSyncManager', () => {
    it('creates a new SyncManager instance on first call', () => {
      const manager = getSyncManager();
      expect(manager).toBeDefined();
    });

    it('returns the same instance on subsequent calls', () => {
      const manager1 = getSyncManager();
      const manager2 = getSyncManager();
      expect(manager1).toBe(manager2);
    });
  });

  describe('triggerSync', () => {
    it('calls sync on the SyncManager', async () => {
      await triggerSync();
      expect(mockSyncManagerInstance.sync).toHaveBeenCalled();
    });
  });
});
