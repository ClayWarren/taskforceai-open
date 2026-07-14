import '../../../test/bun-setup';
import { beforeEach, describe, expect, it, mock } from 'bun:test';

const storeMock = {
  ensureConversation: mock(),
  getConversationMessages: mock(),
  listConversations: mock(),
  upsertMessage: mock(),
  clearConversation: mock(),
  enqueuePrompt: mock(),
  updatePromptStatus: mock(),
  removePrompt: mock(),
  listPendingPrompts: mock(),
  subscribe: mock(),
};

mock.module('expo-crypto', () => ({
  randomUUID: mock(() => 'mock-uuid'),
  AesCryptoModule: {
    EncryptionKey: class MockEncryptionKey {
      id: string = 'mock-key';
    }
  },
}));

mock.module('../database-manager', () => ({
  dbManager: {
    ensureOrm: mock(async () => undefined),
  },
}));

mock.module('@taskforceai/client-runtime', () => ({
  createPersistentConversationStore: mock(() => storeMock),
}));

const { dbManager } = await import('../database-manager');
const chatLocal = await import('../conversations/internal');

describe('chat-local-mobile.internal (Hardening TF-0393, TF-0394)', () => {
  beforeEach(() => {
    dbManager.ensureOrm.mockClear();
    for (const fn of Object.values(storeMock)) {
      fn.mockClear();
    }
  });

  it('listConversations ensures ORM is initialized before querying', async () => {
    storeMock.listConversations.mockResolvedValue([]);

    const result = await chatLocal.listConversations();

    expect(dbManager.ensureOrm).toHaveBeenCalledTimes(1);
    expect(storeMock.listConversations).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([]);
    }
  });

  it('ensureConversation ensures ORM is initialized before querying', async () => {
    storeMock.ensureConversation.mockResolvedValue(undefined);

    await chatLocal.ensureConversation('test-conv', 'Test Title');

    expect(dbManager.ensureOrm).toHaveBeenCalledTimes(1);
    expect(storeMock.ensureConversation).toHaveBeenCalledWith('test-conv', 'Test Title');
  });

  it('getConversationMessages ensures ORM is initialized before querying', async () => {
    storeMock.getConversationMessages.mockResolvedValue([]);

    const result = await chatLocal.getConversationMessages('test-conv');

    expect(dbManager.ensureOrm).toHaveBeenCalledTimes(1);
    expect(storeMock.getConversationMessages).toHaveBeenCalledWith(
      'test-conv',
      undefined,
      undefined
    );
    expect(result.ok).toBe(true);
  });
});
