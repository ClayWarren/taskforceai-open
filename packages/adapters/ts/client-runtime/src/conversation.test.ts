import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';
import type { ConversationSummary } from '@taskforceai/contracts/contracts';
import { err, ok } from '@taskforceai/client-core/result';

import { localSearch } from './local-search';

const mockCreateId = vi.fn((prefix: string) => `${prefix}-test-id`);

mock.module('./id', () => ({
  createId: mockCreateId,
}));

import {
  appendUserMessage,
  createConversation,
  ingestRemoteConversationSummary,
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
  setConversationProjectId: vi.fn().mockResolvedValue(undefined),
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
      hasMoreMessages: false,
    });
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(conversationStore.getConversationMessages).toHaveBeenCalledWith(conversationId, 50, 0);
  });

  it('restores only the requested page and marks when more messages may exist', async () => {
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
          role: 'user',
          content: 'one',
        }),
        createMessageRecord({
          messageId: 'm-2',
          conversationId,
          role: 'assistant',
          content: 'two',
        }),
      ]),
    });

    const result = await restoreConversationSnapshot({
      conversationStore,
      storage,
      activeConversationKey: ACTIVE_CONVERSATION_KEY,
      pageSize: 2,
    });

    expect(result?.messages.map((message) => message.id)).toEqual(['m-1', 'm-2']);
    expect(result?.hasMoreMessages).toBe(true);
    expect(conversationStore.getConversationMessages).toHaveBeenCalledWith(conversationId, 2, 0);
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

  it('stops restoring after message lookup when aborted', async () => {
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
      getConversationMessages: vi.fn().mockResolvedValue([
        createMessageRecord({
          messageId: 'm-1',
          conversationId: 'local-restored',
          role: 'assistant',
          content: 'late',
        }),
      ]),
    });
    const shouldAbort = vi
      .fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    const result = await restoreConversationSnapshot({
      conversationStore,
      storage,
      activeConversationKey: ACTIVE_CONVERSATION_KEY,
      shouldAbort,
    });

    expect(result).toBeNull();
    expect(conversationStore.getConversationMessages).toHaveBeenCalledWith('local-restored', 50, 0);
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

  it('ingests a remote conversation summary into stable local records', async () => {
    const conversationStore = createConversationStore();
    const conversation = createConversationSummary({
      id: 77,
      timestamp: '2026-06-21T12:34:56.000Z',
      user_input: 'Legacy prompt',
      result: 'Legacy answer',
      execution_time: 3.6,
      projectId: 19,
      sources: [{ title: 'Source', url: 'https://example.com' }],
      toolEvents: [{ type: 'tool_call', name: 'search', status: 'completed' } as any],
      agentStatuses: [{ agent: 'writer', status: 'completed', message: 'Done' } as any],
    });

    const conversationId = await ingestRemoteConversationSummary({
      conversationStore,
      conversation,
    });

    expect(conversationId).toBe('remote-77');
    expect(conversationStore.ensureConversation).toHaveBeenCalledWith('remote-77', 'Legacy prompt');
    expect(conversationStore.setConversationProjectId).toHaveBeenCalledWith('remote-77', 19);
    expect(conversationStore.getConversationMessages).toHaveBeenCalledWith('remote-77');
    expect(conversationStore.upsertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'remote-77',
        messageId: 'remote-77-user',
        role: 'user',
        content: 'Legacy prompt',
        createdAt: Date.parse('2026-06-21T12:34:56.000Z'),
      })
    );
    expect(conversationStore.upsertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'remote-77',
        messageId: 'remote-77-agent-status',
        isAgentStatus: true,
        elapsedSeconds: 4,
        sources: [{ title: 'Source', url: 'https://example.com' }],
      })
    );
    expect(conversationStore.upsertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'remote-77',
        messageId: 'remote-77-assistant',
        role: 'assistant',
        content: 'Legacy answer',
        sources: [{ title: 'Source', url: 'https://example.com' }],
      })
    );
  });

  it('normalizes remote summary tool metadata before persisting assistant messages', async () => {
    const conversationStore = createConversationStore();

    await ingestRemoteConversationSummary({
      conversationStore,
      conversation: createConversationSummary({
        id: 78,
        timestamp: '2026-06-21T12:34:56.000Z',
        user_input: 'Create a source-backed brief',
        result: 'Brief ready',
        sources: [
          { url: 'https://example.com/brief', snippet: 'Remote summary' },
          { url: 'https://example.com/plain' },
        ],
        toolEvents: [
          {
            invocationId: 'call-search-1',
            timestamp: '2026-06-21T12:35:00.000Z',
            agentId: 1,
            agentLabel: 'researcher',
            toolName: 'web_search',
            arguments: { query: 'taskforce ai' },
            success: true,
            durationMs: 125,
            status: 'completed',
            resultPreview: 'Found sources',
            image_base64: 'screenshot-data',
            sources: [
              { url: 'https://example.com/tool', title: 'Tool source' },
              { title: 'Missing URL' },
            ],
            generatedFile: {
              filename: 'brief.md',
              artifact_id: 'artifact-1',
              filepath: '/tmp/brief.md',
              mime_type: 'text/markdown',
              bytes: 0,
              file_id: 'file-1',
              download_url: '/api/v1/developer/files/file-1/content',
            },
          } as any,
        ],
        agentStatuses: [
          {
            status: 'RUNNING',
            agent_id: 1,
            progress: 0,
            reasoning: 'Collecting sources',
            model: 'openai/gpt-5',
          },
        ],
      }),
    });

    const assistantUpsert = (
      conversationStore.upsertMessage as ReturnType<typeof vi.fn>
    ).mock.calls.find(([message]) => message.messageId === 'remote-78-assistant')?.[0];

    expect(assistantUpsert).toEqual(
      expect.objectContaining({
        messageId: 'remote-78-assistant',
        sources: [
          { url: 'https://example.com/brief', snippet: 'Remote summary' },
          { url: 'https://example.com/plain' },
        ],
        toolEvents: [
          {
            invocationId: 'call-search-1',
            timestamp: '2026-06-21T12:35:00.000Z',
            agentId: 1,
            agentLabel: 'researcher',
            toolName: 'web_search',
            arguments: { query: 'taskforce ai' },
            success: true,
            durationMs: 125,
            status: 'completed',
            resultPreview: 'Found sources',
            image_base64: 'screenshot-data',
            sources: [{ url: 'https://example.com/tool', title: 'Tool source' }],
            generatedFile: {
              filename: 'brief.md',
              artifactId: 'artifact-1',
              filepath: '/tmp/brief.md',
              mimeType: 'text/markdown',
              bytes: 0,
              fileId: 'file-1',
              downloadUrl: '/api/v1/developer/files/file-1/content',
            },
          },
        ],
        agentStatuses: [
          {
            status: 'RUNNING',
            agent_id: 1,
            progress: 0,
            reasoning: 'Collecting sources',
            model: 'openai/gpt-5',
          },
        ],
      })
    );
    expect(assistantUpsert?.sources?.[1]).not.toHaveProperty('title');
  });

  it('omits malformed generated file metadata from remote summary tool events', async () => {
    const conversationStore = createConversationStore();

    await ingestRemoteConversationSummary({
      conversationStore,
      conversation: createConversationSummary({
        id: 79,
        toolEvents: [
          {
            toolName: 'write_file',
            generatedFile: {
              artifact_id: 'artifact-without-filename',
            },
          } as any,
        ],
      }),
    });

    const assistantUpsert = (
      conversationStore.upsertMessage as ReturnType<typeof vi.fn>
    ).mock.calls.find(([message]) => message.messageId === 'remote-79-assistant')?.[0];

    expect(assistantUpsert?.toolEvents?.[0]).not.toHaveProperty('generatedFile');
  });

  it('preserves existing remote assistant artifacts when a refreshed summary omits them', async () => {
    const conversationStore = createConversationStore({
      getConversationMessages: vi.fn().mockResolvedValue([
        createMessageRecord({
          conversationId: 'remote-77',
          messageId: 'remote-77-agent-status',
          role: 'assistant',
          content: '',
          sources: [{ title: 'Existing Source', url: 'https://example.com/existing' }] as any,
          agentStatuses: [{ agent: 'reader', status: 'completed', message: 'Cached' } as any],
        }),
        createMessageRecord({
          conversationId: 'remote-77',
          messageId: 'remote-77-assistant',
          role: 'assistant',
          content: 'Previous answer',
          toolEvents: [{ type: 'tool_call', name: 'lookup', status: 'completed' } as any],
        }),
      ]),
    });

    await ingestRemoteConversationSummary({
      conversationStore,
      conversation: createConversationSummary({
        id: 77,
        user_input: 'Refreshed prompt',
        result: 'Refreshed answer',
        sources: [],
        toolEvents: [],
        agentStatuses: [],
      }),
    });

    expect(conversationStore.upsertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'remote-77-agent-status',
        sources: [{ title: 'Existing Source', url: 'https://example.com/existing' }],
        agentStatuses: [{ agent: 'reader', status: 'completed', message: 'Cached' }],
      })
    );
    expect(conversationStore.upsertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'remote-77-assistant',
        sources: [{ title: 'Existing Source', url: 'https://example.com/existing' }],
        toolEvents: [{ type: 'tool_call', name: 'lookup', status: 'completed' }],
      })
    );
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
