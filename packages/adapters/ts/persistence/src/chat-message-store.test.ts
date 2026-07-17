import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import {
  createStorageMock,
  messageResultError,
  storageConversation,
  type StorageAdapterMock,
} from '#tests/fixtures/sync-storage';
import { ok } from '@taskforceai/client-core/result';
import { MessageStore } from './chat-message-store';
import type { ConversationStore } from './chat-conversation-store';
import type { StorageMessage } from './storage-adapter';

type ConversationStoreMock = {
  updateLastMessagePreview: ReturnType<typeof vi.fn<ConversationStore['updateLastMessagePreview']>>;
};

const createConversationStoreMock = (): ConversationStoreMock => ({
  updateLastMessagePreview: vi
    .fn<ConversationStore['updateLastMessagePreview']>()
    .mockResolvedValue({ ok: true, value: storageConversation({ createdAt: 1, updatedAt: 1 }) }),
});

describe('persistence/chat-message-store', () => {
  let storage: StorageAdapterMock;
  let conversationStore: ConversationStoreMock;
  let store: MessageStore;

  beforeEach(() => {
    storage = createStorageMock({
      message: {
        messageId: 'msg-existing',
        role: 'assistant',
        content: 'old',
        isStreaming: true,
        sources: [{ url: 'https://source.old' }],
        toolEvents: [
          {
            agentLabel: 'Agent',
            toolName: 'search',
            success: true,
            durationMs: 10,
            arguments: {},
          },
        ],
        agentStatuses: [{ status: 'running', progress: 0.5 }],
      },
    });
    conversationStore = createConversationStoreMock();
    store = new MessageStore(storage, conversationStore as unknown as ConversationStore);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('updates existing message and preserves optional arrays when omitted', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1710001000000);

    await store.upsertMessage({
      conversationId: 'conv-1',
      messageId: 'msg-existing',
      role: 'assistant',
      content: 'new content',
      isStreaming: false,
    });

    expect(storage.upsertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'msg-existing',
        content: 'new content',
        isStreaming: false,
        updatedAt: 1710001000000,
        sources: [{ url: 'https://source.old' }],
        toolEvents: [
          {
            agentLabel: 'Agent',
            toolName: 'search',
            success: true,
            durationMs: 10,
            arguments: {},
          },
        ],
        agentStatuses: [{ status: 'running', progress: 0.5 }],
      })
    );
    expect(conversationStore.updateLastMessagePreview).toHaveBeenCalledWith(
      'conv-1',
      'new content',
      1710001000000
    );
  });

  it('updates existing optional fields when explicitly provided', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1710001000100);

    await store.upsertMessage({
      conversationId: 'conv-1',
      messageId: 'msg-existing',
      role: 'assistant',
      content: 'replace arrays',
      isStreaming: true,
      sources: [{ url: 'https://new.source' }],
      toolEvents: [],
      agentStatuses: [{ status: 'completed', result: 'done' }],
      error: null,
      isAgentStatus: true,
      elapsedSeconds: 42,
    });

    expect(storage.upsertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: [{ url: 'https://new.source' }],
        toolEvents: [],
        agentStatuses: [{ status: 'completed', result: 'done' }],
        error: null,
        isAgentStatus: true,
        elapsedSeconds: 42,
      })
    );
  });

  it('preserves existing trace id when no replacement is provided', async () => {
    storage.getMessage.mockResolvedValueOnce(
      ok({
        messageId: 'msg-existing',
        conversationId: 'conv-1',
        role: 'assistant',
        content: 'old',
        isStreaming: false,
        createdAt: 1,
        updatedAt: 2,
        traceId: 'trace-existing',
        syncVersion: 0,
        lastSyncedAt: 0,
        isDeleted: false,
      })
    );

    await store.upsertMessage({
      conversationId: 'conv-1',
      messageId: 'msg-existing',
      role: 'assistant',
      content: 'keeps trace',
      isStreaming: false,
    });

    expect(storage.upsertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'msg-existing',
        traceId: 'trace-existing',
      })
    );
  });

  it('does not update preview when an inherited agent status message is rewritten', async () => {
    storage.getMessage.mockResolvedValueOnce(
      ok({
        messageId: 'msg-agent-status-existing',
        conversationId: 'conv-1',
        role: 'assistant',
        content: 'running',
        isStreaming: true,
        isAgentStatus: true,
        createdAt: 1,
        updatedAt: 2,
        syncVersion: 0,
        lastSyncedAt: 0,
        isDeleted: false,
      })
    );

    await store.upsertMessage({
      conversationId: 'conv-1',
      messageId: 'msg-agent-status-existing',
      role: 'assistant',
      content: 'still running',
      isStreaming: true,
    });

    expect(conversationStore.updateLastMessagePreview).not.toHaveBeenCalled();
  });

  it('updates existing message conversation and role when changed', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1710001000150);

    await store.upsertMessage({
      conversationId: 'conv-2',
      messageId: 'msg-existing',
      role: 'user',
      content: 'moved message',
      isStreaming: false,
    });

    expect(storage.upsertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'msg-existing',
        conversationId: 'conv-2',
        role: 'user',
        content: 'moved message',
        isStreaming: false,
        updatedAt: 1710001000150,
      })
    );
    expect(conversationStore.updateLastMessagePreview).toHaveBeenCalledWith(
      'conv-2',
      'moved message',
      1710001000150
    );
  });

  it('creates a new message with defaults when missing', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1710001000200);
    storage.getMessage.mockResolvedValueOnce(messageResultError('NOT_FOUND'));

    await store.upsertMessage({
      conversationId: 'conv-2',
      messageId: 'msg-new',
      role: 'user',
      content: 'first message',
      isStreaming: true,
      error: 'temporary',
      elapsedSeconds: 1,
    });

    expect(storage.upsertMessage).toHaveBeenCalledWith({
      messageId: 'msg-new',
      conversationId: 'conv-2',
      role: 'user',
      content: 'first message',
      isStreaming: true,
      createdAt: 1710001000200,
      updatedAt: 1710001000200,
      sources: [],
      toolEvents: [],
      agentStatuses: [],
      syncVersion: 0,
      lastSyncedAt: 0,
      isDeleted: false,
      error: 'temporary',
      elapsedSeconds: 1,
    });
    expect(conversationStore.updateLastMessagePreview).toHaveBeenCalledWith(
      'conv-2',
      'first message',
      1710001000200
    );
  });

  it('uses caller timestamps and local command output flag when creating a message', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1710001000225);
    storage.getMessage.mockResolvedValueOnce(messageResultError('NOT_FOUND'));

    await store.upsertMessage({
      conversationId: 'conv-2',
      messageId: 'msg-local-command',
      role: 'assistant',
      content: 'command output',
      isStreaming: false,
      isLocalCommandOutput: true,
      createdAt: 1710001000100,
      updatedAt: 1710001000200,
    });

    expect(storage.upsertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'msg-local-command',
        createdAt: 1710001000100,
        updatedAt: 1710001000200,
        isLocalCommandOutput: true,
      })
    );
    expect(conversationStore.updateLastMessagePreview).toHaveBeenCalledWith(
      'conv-2',
      'command output',
      1710001000200
    );
  });

  it('updates local command output flag and respects caller updatedAt for existing messages', async () => {
    await store.upsertMessage({
      conversationId: 'conv-1',
      messageId: 'msg-existing',
      role: 'assistant',
      content: 'updated command output',
      isStreaming: false,
      isLocalCommandOutput: false,
      updatedAt: 1710001000300,
    });

    expect(storage.upsertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'msg-existing',
        updatedAt: 1710001000300,
        isLocalCommandOutput: false,
      })
    );
    expect(conversationStore.updateLastMessagePreview).toHaveBeenCalledWith(
      'conv-1',
      'updated command output',
      1710001000300
    );
  });

  it('does not create a new message when storage error text contains not found', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1710001000250);
    storage.getMessage.mockResolvedValueOnce(
      messageResultError(new Error('Tauri command not found'))
    );

    await expect(
      store.upsertMessage({
        conversationId: 'conv-2',
        messageId: 'msg-storage-error-not-found',
        role: 'assistant',
        content: 'should not be created',
        isStreaming: false,
      })
    ).rejects.toThrow('Tauri command not found');

    expect(storage.upsertMessage).not.toHaveBeenCalled();
  });

  it('creates a new message when adapter returns typed not found', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1710001000250);
    storage.getMessage.mockResolvedValueOnce(messageResultError('NOT_FOUND'));

    await store.upsertMessage({
      conversationId: 'conv-2',
      messageId: 'msg-new-error-not-found',
      role: 'assistant',
      content: 'created from error',
      isStreaming: false,
      sources: [{ url: 'https://source.example' }],
      toolEvents: [
        {
          agentLabel: 'Agent',
          toolName: 'search',
          success: true,
          durationMs: 5,
          arguments: {},
        },
      ],
      agentStatuses: [{ status: 'completed', result: 'ok' }],
      isAgentStatus: false,
      traceId: 'trace-created',
    });

    expect(storage.upsertMessage).toHaveBeenCalledWith({
      messageId: 'msg-new-error-not-found',
      conversationId: 'conv-2',
      role: 'assistant',
      content: 'created from error',
      isStreaming: false,
      createdAt: 1710001000250,
      updatedAt: 1710001000250,
      sources: [{ url: 'https://source.example' }],
      toolEvents: [
        {
          agentLabel: 'Agent',
          toolName: 'search',
          success: true,
          durationMs: 5,
          arguments: {},
        },
      ],
      agentStatuses: [{ status: 'completed', result: 'ok' }],
      traceId: 'trace-created',
      syncVersion: 0,
      lastSyncedAt: 0,
      isDeleted: false,
      isAgentStatus: false,
    });
  });

  it('does not update conversation preview for system role', async () => {
    storage.getMessage.mockResolvedValueOnce(messageResultError('NOT_FOUND'));

    await store.upsertMessage({
      conversationId: 'conv-1',
      messageId: 'msg-system',
      role: 'system',
      content: 'internal',
      isStreaming: false,
    });

    expect(conversationStore.updateLastMessagePreview).not.toHaveBeenCalled();
  });

  it('does not update conversation preview for agent-status messages or empty content', async () => {
    storage.getMessage
      .mockResolvedValueOnce(messageResultError('NOT_FOUND'))
      .mockResolvedValueOnce(messageResultError('NOT_FOUND'))
      .mockResolvedValueOnce(messageResultError('NOT_FOUND'));

    await store.upsertMessage({
      conversationId: 'conv-1',
      messageId: 'msg-agent-status',
      role: 'assistant',
      content: '',
      isStreaming: true,
      isAgentStatus: true,
    });

    await store.upsertMessage({
      conversationId: 'conv-1',
      messageId: 'msg-empty',
      role: 'assistant',
      content: '',
      isStreaming: false,
    });

    await store.upsertMessage({
      conversationId: 'conv-1',
      messageId: 'msg-whitespace',
      role: 'assistant',
      content: '   ',
      isStreaming: false,
    });

    expect(conversationStore.updateLastMessagePreview).not.toHaveBeenCalled();
  });

  it('accepts trace_id alias when upserting messages', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1710001000300);
    storage.getMessage.mockResolvedValueOnce(messageResultError('NOT_FOUND'));

    await store.upsertMessage({
      conversationId: 'conv-2',
      messageId: 'msg-trace',
      role: 'assistant',
      content: 'with trace',
      isStreaming: false,
      trace_id: 'trace-123',
    });

    expect(storage.upsertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'msg-trace',
        traceId: 'trace-123',
      })
    );
  });

  it('throws when getMessage fails with storage error', async () => {
    storage.getMessage.mockResolvedValueOnce(messageResultError(new Error('database unavailable')));

    expect(
      store.upsertMessage({
        conversationId: 'conv-1',
        messageId: 'msg-fail',
        role: 'assistant',
        content: 'should fail',
        isStreaming: false,
      })
    ).rejects.toThrow('database unavailable');

    expect(storage.upsertMessage).not.toHaveBeenCalled();
  });

  it('wraps non-error storage failures from getMessage', async () => {
    storage.getMessage.mockResolvedValueOnce(messageResultError('database unavailable'));

    await expect(
      store.upsertMessage({
        conversationId: 'conv-1',
        messageId: 'msg-fail-string',
        role: 'assistant',
        content: 'should fail',
        isStreaming: false,
      })
    ).rejects.toThrow('database unavailable');

    expect(storage.upsertMessage).not.toHaveBeenCalled();
  });

  it('proxies getConversationMessages to adapter', async () => {
    const expectedMessages: StorageMessage[] = [
      {
        messageId: 'msg-1',
        conversationId: 'conv-7',
        role: 'assistant',
        content: 'hi',
        isStreaming: false,
        createdAt: 1,
        updatedAt: 2,
        syncVersion: 0,
        lastSyncedAt: 0,
        isDeleted: false,
      },
    ];
    storage.getMessages.mockResolvedValueOnce(expectedMessages);

    const result = await store.getConversationMessages('conv-7', 10, 5);

    expect(storage.getMessages).toHaveBeenCalledWith('conv-7', 10, 5);
    expect(result).toEqual(expectedMessages);
  });
});
