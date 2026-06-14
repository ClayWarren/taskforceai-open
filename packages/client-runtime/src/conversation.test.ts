import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';
import type { ConversationSummary } from '@taskforceai/contracts/contracts';
import { localSearch } from '@taskforceai/shared';
import { err, ok } from '@taskforceai/shared/result';

const mockCreateId = vi.fn((prefix: string) => `${prefix}-test-id`);

mock.module('@taskforceai/shared/utils/id', () => ({
  createId: mockCreateId,
}));

import {
  appendUserMessage,
  createConversation,
  loadConversationSnapshot,
  loadMoreConversationMessages,
  resolveConversationStorageId,
  restoreConversationSnapshot,
} from './conversation';
import type { ConversationStore, KeyValueStorage, MessageRecord } from './types';

const ACTIVE_CONVERSATION_KEY = 'active-conversation';

const createConversationStore = (
  overrides: Partial<ConversationStore> = {}
): ConversationStore => ({
  ensureConversation: vi.fn().mockResolvedValue(undefined),
  renameConversation: vi.fn().mockResolvedValue(undefined),
  getConversation: vi
    .fn()
    .mockResolvedValue(err({ kind: 'not_found' as const, message: 'Missing conversation' })),
  getConversationMessages: vi.fn().mockResolvedValue([]),
  upsertMessage: vi.fn().mockResolvedValue(undefined),
  listConversations: vi.fn().mockResolvedValue([]),
  clearConversation: vi.fn().mockResolvedValue(undefined),
  enqueuePrompt: vi.fn().mockResolvedValue(undefined),
  updatePromptStatus: vi.fn().mockResolvedValue(undefined),
  removePrompt: vi.fn().mockResolvedValue(undefined),
  listPendingPrompts: vi.fn().mockResolvedValue([]),
  subscribe: vi.fn().mockReturnValue(() => {}),
  ...overrides,
});

const createStorage = (overrides: Partial<KeyValueStorage> = {}): KeyValueStorage => ({
  getItem: vi.fn().mockResolvedValue(null),
  setItem: vi.fn().mockResolvedValue(undefined),
  removeItem: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

const createMessageRecord = (
  overrides: Partial<MessageRecord> &
    Pick<MessageRecord, 'messageId' | 'conversationId' | 'role' | 'content'>
): MessageRecord => ({
  isStreaming: false,
  createdAt: 1,
  updatedAt: 2,
  ...overrides,
});

const createConversationSummary = (
  overrides: Partial<ConversationSummary> = {}
): ConversationSummary => ({
  id: 42,
  timestamp: '2025-01-01T00:00:00Z',
  user_input: 'Prompt',
  result: 'Result',
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(1234567890);
});

describe('client-runtime conversation helpers', () => {
  it('restores a saved conversation and hydrates stored message records', async () => {
    const conversationId = 'local-restored';
    const storage = createStorage({
      getItem: vi.fn().mockResolvedValue(conversationId),
    });
    const conversationStore = createConversationStore({
      getConversation: vi.fn().mockResolvedValue(
        ok({
          conversationId,
          title: 'Restored',
          createdAt: 1,
          updatedAt: 2,
          lastMessagePreview: null,
        })
      ),
      getConversationMessages: vi.fn().mockResolvedValue([
        createMessageRecord({
          messageId: 'm-1',
          conversationId,
          role: 'assistant',
          content: 'hello',
          isStreaming: true,
          isAgentStatus: true,
          isLocalCommandOutput: true,
          elapsedSeconds: 8,
          createdAt: 10,
          updatedAt: 11,
          trace_id: 'trace-1',
          sources: [{ title: 'Doc', url: 'https://example.com' } as any],
          toolEvents: [
            {
              agentLabel: 'planner',
              toolName: 'search',
              arguments: { query: 'Doc' },
              success: true,
              durationMs: 42,
            },
          ],
          agentStatuses: [{ status: 'COMPLETE' } as any],
        }),
      ]),
    });

    const result = await restoreConversationSnapshot({
      conversationStore,
      storage,
      activeConversationKey: ACTIVE_CONVERSATION_KEY,
    });

    expect(result).toEqual({
      conversationId,
      messages: [
        {
          id: 'm-1',
          content: 'hello',
          role: 'assistant',
          sources: [{ title: 'Doc', url: 'https://example.com' }],
          toolEvents: [
            {
              agentLabel: 'planner',
              toolName: 'search',
              arguments: { query: 'Doc' },
              success: true,
              durationMs: 42,
            },
          ],
          agentStatuses: [{ status: 'COMPLETE' }],
          trace_id: 'trace-1',
          isStreaming: true,
          isAgentStatus: true,
          isLocalCommandOutput: true,
          elapsedSeconds: 8,
          createdAt: 10,
          updatedAt: 11,
        },
      ],
    });
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(conversationStore.getConversationMessages).toHaveBeenCalledWith(conversationId);
  });

  it('does not clear saved conversation state when restoration is aborted', async () => {
    const storage = createStorage({
      getItem: vi.fn().mockResolvedValue('local-restored'),
    });
    const conversationStore = createConversationStore();

    const result = await restoreConversationSnapshot({
      conversationStore,
      storage,
      activeConversationKey: ACTIVE_CONVERSATION_KEY,
      shouldAbort: vi.fn().mockReturnValue(true),
    });

    expect(result).toBeNull();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(conversationStore.getConversation).not.toHaveBeenCalled();
  });

  it('stops restoring after conversation lookup when aborted', async () => {
    const storage = createStorage({
      getItem: vi.fn().mockResolvedValue('local-restored'),
    });
    const conversationStore = createConversationStore({
      getConversation: vi.fn().mockResolvedValue(
        ok({
          conversationId: 'local-restored',
          title: 'Restored',
          createdAt: 1,
          updatedAt: 2,
          lastMessagePreview: null,
        })
      ),
    });
    const shouldAbort = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);

    const result = await restoreConversationSnapshot({
      conversationStore,
      storage,
      activeConversationKey: ACTIVE_CONVERSATION_KEY,
      shouldAbort,
    });

    expect(result).toBeNull();
    expect(conversationStore.getConversation).toHaveBeenCalledWith('local-restored');
    expect(conversationStore.getConversationMessages).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('returns null when no active conversation id was saved', async () => {
    const storage = createStorage({
      getItem: vi.fn().mockResolvedValue(null),
    });
    const conversationStore = createConversationStore();

    const result = await restoreConversationSnapshot({
      conversationStore,
      storage,
      activeConversationKey: ACTIVE_CONVERSATION_KEY,
    });

    expect(result).toBeNull();
    expect(conversationStore.getConversation).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('removes a stale saved conversation id when the conversation no longer exists', async () => {
    const storage = createStorage({
      getItem: vi.fn().mockResolvedValue('local-stale'),
    });
    const conversationStore = createConversationStore();

    const result = await restoreConversationSnapshot({
      conversationStore,
      storage,
      activeConversationKey: ACTIVE_CONVERSATION_KEY,
    });

    expect(result).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith(ACTIVE_CONVERSATION_KEY);
    expect(conversationStore.getConversationMessages).not.toHaveBeenCalled();
  });

  it('creates and persists a new local conversation id', async () => {
    const storage = createStorage();
    const conversationStore = createConversationStore();

    const conversationId = await createConversation({
      conversationStore,
      storage,
      activeConversationKey: ACTIVE_CONVERSATION_KEY,
    });

    expect(conversationId).toBe('local-test-id');
    expect(conversationStore.ensureConversation).toHaveBeenCalledWith(
      'local-test-id',
      'New Conversation'
    );
    expect(storage.setItem).toHaveBeenCalledWith(ACTIVE_CONVERSATION_KEY, 'local-test-id');
  });

  it('appends a user message, updates the conversation title, and indexes it for search', async () => {
    const addItemSpy = vi.spyOn(localSearch, 'addItem').mockImplementation(() => {});
    const conversationStore = createConversationStore();

    const message = await appendUserMessage({
      conversationStore,
      conversationId: 'local-thread',
      content: '  Hello world  ',
    });

    expect(message).toEqual({
      id: 'user-test-id',
      content: '  Hello world  ',
      role: 'user',
      sources: [],
      createdAt: 1234567890,
      updatedAt: 1234567890,
    });
    expect(conversationStore.ensureConversation).toHaveBeenCalledWith(
      'local-thread',
      'Hello world'
    );
    expect(conversationStore.upsertMessage).toHaveBeenCalledWith({
      conversationId: 'local-thread',
      messageId: 'user-test-id',
      role: 'user',
      content: '  Hello world  ',
      isStreaming: false,
      createdAt: 1234567890,
      updatedAt: 1234567890,
    });
    expect(addItemSpy).toHaveBeenCalledWith({
      id: 'user-test-id',
      title: 'Hello world',
      content: '  Hello world  ',
      tags: ['local-thread', 'user'],
    });
  });

  it('loads a public conversation snapshot and resolves the remote storage id', async () => {
    const conversationStore = createConversationStore({
      getConversationMessages: vi.fn().mockResolvedValue([
        createMessageRecord({
          messageId: 'm-2',
          conversationId: 'remote-42',
          role: 'assistant',
          content: 'ready',
          createdAt: 20,
          updatedAt: 21,
        }),
        createMessageRecord({
          messageId: 'm-3',
          conversationId: 'remote-42',
          role: 'user',
          content: 'continue',
          createdAt: 22,
          updatedAt: 23,
        }),
      ]),
    });
    const storage = createStorage();
    const conversation = createConversationSummary({
      id: 42,
      isPublic: true,
      shareId: 'share-123',
    });

    const snapshot = await loadConversationSnapshot({
      conversationStore,
      storage,
      activeConversationKey: ACTIVE_CONVERSATION_KEY,
      conversation,
      pageSize: 2,
    } as any);

    expect(resolveConversationStorageId(conversation)).toBe('remote-42');
    expect(snapshot).toEqual({
      conversationId: 'remote-42',
      messages: [
        {
          id: 'm-2',
          content: 'ready',
          role: 'assistant',
          sources: [],
          toolEvents: [],
          agentStatuses: [],
          trace_id: undefined,
          isStreaming: false,
          createdAt: 20,
          updatedAt: 21,
        },
        {
          id: 'm-3',
          content: 'continue',
          role: 'user',
          sources: [],
          toolEvents: [],
          agentStatuses: [],
          trace_id: undefined,
          isStreaming: false,
          createdAt: 22,
          updatedAt: 23,
        },
      ],
      hasMoreMessages: true,
      isPublic: true,
      shareId: 'share-123',
    });
    expect(storage.setItem).toHaveBeenCalledWith(ACTIVE_CONVERSATION_KEY, 'remote-42');
    expect(conversationStore.getConversationMessages).toHaveBeenCalledWith('remote-42', 2, 0);
  });

  it('loads more messages using the requested offset and page size', async () => {
    const conversationStore = createConversationStore({
      getConversationMessages: vi.fn().mockResolvedValue([
        createMessageRecord({
          messageId: 'm-4',
          conversationId: 'local-9',
          role: 'assistant',
          content: 'extra',
          createdAt: 30,
          updatedAt: 31,
        }),
      ]),
    });

    const result = await loadMoreConversationMessages({
      conversationStore,
      conversationId: 'local-9',
      offset: 2,
      pageSize: 1,
    });

    expect(result).toEqual({
      messages: [
        {
          id: 'm-4',
          content: 'extra',
          role: 'assistant',
          sources: [],
          toolEvents: [],
          agentStatuses: [],
          trace_id: undefined,
          isStreaming: false,
          createdAt: 30,
          updatedAt: 31,
        },
      ],
      hasMoreMessages: true,
    });
    expect(conversationStore.getConversationMessages).toHaveBeenCalledWith('local-9', 1, 2);
  });
});
