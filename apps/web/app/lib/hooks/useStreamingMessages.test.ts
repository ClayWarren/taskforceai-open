import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';
import React from 'react';

import '../../../../../tests/setup/dom';
import type { ConversationStore } from '../platform/platform-interfaces';
import type { Message } from '../types';
import { useStreamingMessages } from './useStreamingMessages';

type StreamingOptions = Parameters<typeof useStreamingMessages>[0];

const localSearchMock = {
  addItem: vi.fn(),
  removeItem: vi.fn(),
};

const conversationStoreMock = {
  ensureConversation: vi.fn(),
  getConversation: vi.fn(),
  getConversationMessages: vi.fn(),
  listConversations: vi.fn(),
  renameConversation: vi.fn(),
  upsertMessage: vi.fn(),
  clearConversation: vi.fn(),
  enqueuePrompt: vi.fn(),
  updatePromptStatus: vi.fn(),
  removePrompt: vi.fn(),
  listPendingPrompts: vi.fn(),
  subscribe: vi.fn(() => () => {}),
} satisfies ConversationStore;

let idCounter = 0;
const createIdMock = vi.fn((prefix: string) => {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
});

mock.module('@taskforceai/shared', () => ({ localSearch: localSearchMock }));
vi.mock('../platform/PlatformProvider', () => ({
  useConversationStore: () => conversationStoreMock,
}));
vi.mock('@taskforceai/shared/utils/id', () => ({ createId: createIdMock }));
vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const buildProps = (overrides: Partial<StreamingOptions> = {}): StreamingOptions => ({
  isStreaming: true,
  streamContent: '',
  finalResponse: null,
  errorMessage: null,
  conversationId: 'conversation-1',
  ensureActiveConversation: vi.fn().mockResolvedValue('conversation-1'),
  setMessages: vi.fn(),
  sources: [],
  finalSources: [],
  toolEvents: [],
  finalToolEvents: [],
  elapsedSeconds: 0,
  agentStatuses: [],
  trace_id: null,
  pendingApproval: null,
  ...overrides,
});

const renderStreamingHook = (initialProps: Partial<StreamingOptions> = {}) =>
  renderHook(
    (props: StreamingOptions) => {
      const [messages, setMessages] = React.useState<Message[]>([]);
      const streamingState = useStreamingMessages({ ...props, setMessages });
      return { messages, streamingState };
    },
    { initialProps: buildProps(initialProps) }
  );

beforeEach(() => {
  vi.clearAllMocks();
  idCounter = 0;
  conversationStoreMock.upsertMessage.mockResolvedValue(undefined);
  conversationStoreMock.subscribe.mockReturnValue(() => {});
});

describe('useStreamingMessages web adapter', () => {
  it('creates persisted status and content placeholders', async () => {
    const { result } = renderStreamingHook();

    await waitFor(() =>
      expect(result.current.streamingState.streamingMessageId).toBe('assistant-2')
    );

    expect(result.current.messages).toHaveLength(2);
    expect(conversationStoreMock.upsertMessage).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'assistant-1', isAgentStatus: true })
    );
    expect(conversationStoreMock.upsertMessage).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'assistant-2', isAgentStatus: false })
    );
  });

  it('persists final responses and indexes assistant content', async () => {
    const { result, rerender } = renderStreamingHook();

    await waitFor(() =>
      expect(result.current.streamingState.streamingMessageId).toBe('assistant-2')
    );
    await act(async () => {
      rerender(buildProps({ isStreaming: false, finalResponse: 'Done' }));
    });

    await waitFor(() =>
      expect(conversationStoreMock.upsertMessage).toHaveBeenCalledWith(
        expect.objectContaining({ messageId: 'assistant-2', content: 'Done', isStreaming: false })
      )
    );
    expect(localSearchMock.addItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'assistant-2', content: 'Done' })
    );
  });

  it('persists final response sources derived from completed tool events', async () => {
    const source = { url: 'https://source.example/story', title: 'Source Story' };
    const { result, rerender } = renderStreamingHook({
      finalToolEvents: [
        {
          agentLabel: 'Research',
          toolName: 'web_search',
          arguments: { query: 'source story' },
          success: true,
          durationMs: 150,
          sources: [source],
        },
      ],
    });

    await waitFor(() =>
      expect(result.current.streamingState.streamingMessageId).toBe('assistant-2')
    );
    await act(async () => {
      rerender(
        buildProps({
          isStreaming: false,
          finalResponse: 'Done',
          finalToolEvents: [
            {
              agentLabel: 'Research',
              toolName: 'web_search',
              arguments: { query: 'source story' },
              success: true,
              durationMs: 150,
              sources: [source],
            },
          ],
        })
      );
    });

    await waitFor(() =>
      expect(conversationStoreMock.upsertMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: 'assistant-2',
          content: 'Done',
          isStreaming: false,
          sources: [source],
        })
      )
    );
  });

  it('persists errors immediately and indexes the failed response', async () => {
    const { result, rerender } = renderStreamingHook();

    await waitFor(() =>
      expect(result.current.streamingState.streamingMessageId).toBe('assistant-2')
    );
    await act(async () => {
      rerender(buildProps({ isStreaming: false, errorMessage: 'Network failure' }));
    });

    await waitFor(() => expect(result.current.messages[1]?.content).toBe('Network failure'));
    expect(conversationStoreMock.upsertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'assistant-2',
        content: 'Network failure',
        isStreaming: false,
      })
    );
    expect(localSearchMock.addItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'assistant-2', content: 'Network failure' })
    );
  });
});
