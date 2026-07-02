import { beforeEach, describe, expect, it, vi } from 'bun:test';

const messagesTable = {
  add: vi.fn(),
  update: vi.fn(),
  where: vi.fn(),
};
const mapToStorageMessageMock = vi.fn();
const createDexieMessageDataMock = vi.fn();

vi.mock('@taskforceai/web/lib/dexie-db', () => ({
  db: {
    messages: messagesTable,
  },
}));

vi.mock('@taskforceai/persistence/chat-normalizers', () => ({
  mapToStorageMessage: mapToStorageMessageMock,
}));

vi.mock('./dexie-message-data', () => ({
  createDexieMessageData: createDexieMessageDataMock,
}));

import {
  deleteDexieMessage,
  getDexieMessage,
  listDexieMessages,
  upsertDexieMessage,
} from './dexie-messages';

const storageMessage = {
  messageId: 'message-1',
  conversationId: 'conversation-1',
  role: 'user',
  content: 'Hello',
  createdAt: 1000,
  updatedAt: 1000,
};

describe('dexie message storage adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    messagesTable.add.mockResolvedValue(1);
    messagesTable.update.mockResolvedValue(1);
    mapToStorageMessageMock.mockImplementation((message) => ({
      messageId: message.messageId,
      mapped: true,
    }));
    createDexieMessageDataMock.mockReturnValue({ persisted: true });
  });

  it('lists messages by conversation with optional pagination and maps rows to storage messages', async () => {
    const query = {
      between: vi.fn(),
      limit: vi.fn(),
      offset: vi.fn(),
      toArray: vi.fn(async () => [{ messageId: 'message-1' }, { messageId: 'message-2' }]),
    };
    query.between.mockReturnValue(query);
    query.offset.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    messagesTable.where.mockReturnValue(query);

    const result = await listDexieMessages('conversation-1', 25, 50);

    expect(messagesTable.where).toHaveBeenCalledWith('[conversationId+createdAt]');
    expect(query.between).toHaveBeenCalledWith(
      ['conversation-1', expect.anything()],
      ['conversation-1', expect.anything()]
    );
    expect(query.offset).toHaveBeenCalledWith(50);
    expect(query.limit).toHaveBeenCalledWith(25);
    const expectedMessages = [
      { messageId: 'message-1', mapped: true },
      { messageId: 'message-2', mapped: true },
    ] as unknown;
    expect(result as unknown).toEqual(expectedMessages);
  });

  it('returns a mapped message for an existing message id', async () => {
    const first = vi.fn(async () => ({ messageId: 'message-1' }));
    const equals = vi.fn(() => ({ first }));
    messagesTable.where.mockReturnValue({ equals });

    const result = await getDexieMessage('message-1');

    expect(messagesTable.where).toHaveBeenCalledWith('messageId');
    expect(equals).toHaveBeenCalledWith('message-1');
    const expectedResult = {
      ok: true,
      value: { messageId: 'message-1', mapped: true },
    } as unknown;
    expect(result as unknown).toEqual(expectedResult);
  });

  it('returns an error result when a message id is missing', async () => {
    const first = vi.fn(async () => undefined);
    messagesTable.where.mockReturnValue({ equals: vi.fn(() => ({ first })) });

    const result = await getDexieMessage('missing-message');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Message not found');
    }
  });

  it('updates an existing message by Dexie id', async () => {
    const first = vi.fn(async () => ({ id: 7, messageId: 'message-1' }));
    const equals = vi.fn(() => ({ first }));
    messagesTable.where.mockReturnValue({ equals });

    await upsertDexieMessage(storageMessage as any);

    expect(equals).toHaveBeenCalledWith('message-1');
    expect(messagesTable.update).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        messageId: 'message-1',
        updatedAt: expect.any(Number),
      })
    );
    expect(messagesTable.add).not.toHaveBeenCalled();
  });

  it('adds a new message when no existing Dexie id is found', async () => {
    const first = vi.fn(async () => ({ messageId: 'message-1' }));
    messagesTable.where.mockReturnValue({ equals: vi.fn(() => ({ first })) });

    await upsertDexieMessage(storageMessage as any);

    expect(createDexieMessageDataMock).toHaveBeenCalledWith(storageMessage);
    expect(messagesTable.add).toHaveBeenCalledWith({ persisted: true });
    expect(messagesTable.update).not.toHaveBeenCalled();
  });

  it('deletes messages by message id', async () => {
    const deleteMock = vi.fn(async () => 1);
    const equals = vi.fn(() => ({ delete: deleteMock }));
    messagesTable.where.mockReturnValue({ equals });

    await deleteDexieMessage('message-1');

    expect(messagesTable.where).toHaveBeenCalledWith('messageId');
    expect(equals).toHaveBeenCalledWith('message-1');
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });
});
