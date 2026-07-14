import { beforeEach, describe, expect, it, mock } from 'bun:test';

const ensureOrmMock = mock(async () => ({}));
const clearChatDataMock = mock(async () => undefined);

mock.module('../database-manager', () => ({
  dbManager: {
    ensureOrm: ensureOrmMock,
  },
}));

mock.module('../sqlite-adapter', () => ({
  sqliteStorage: {
    clearChatData: clearChatDataMock,
  },
}));

describe('chat-local-mobile delete all conversations', () => {
  beforeEach(() => {
    ensureOrmMock.mockClear();
    clearChatDataMock.mockClear();
  });

  it('clears the targeted local chat data store', async () => {
    const { deleteAllConversations } = await import('../conversations/internal');

    await deleteAllConversations();

    expect(ensureOrmMock).toHaveBeenCalledTimes(1);
    expect(clearChatDataMock).toHaveBeenCalledTimes(1);
  });
});
