import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';

// Mock the tauri storage
const mockTauriStorage = {
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
  keys: vi.fn(),
};

const createPersistentConversationStore = vi.fn(() => ({ kind: 'store' }));

// Mock modules before importing the module under test
mock.module('../storage/tauri-adapter', () => ({
  tauriStorage: mockTauriStorage,
}));

mock.module('@taskforceai/web/app/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
}));

mock.module('@taskforceai/client-runtime', () => ({
  createPersistentConversationStore,
}));

// Now import the module under test
const { createDesktopConversationStore } = await import('./conversation-store');

describe('DesktopConversationStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createDesktopConversationStore', () => {
    it('creates a conversation store instance', () => {
      const store = createDesktopConversationStore();
      expect(store).toBeDefined();
    });

    it('uses tauriStorage as the storage backend', () => {
      createDesktopConversationStore();
      expect(createPersistentConversationStore).toHaveBeenCalledWith({
        adapter: mockTauriStorage,
        logger: expect.objectContaining({
          warn: expect.any(Function),
          error: expect.any(Function),
        }),
      });
    });
  });
});
