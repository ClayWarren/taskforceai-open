import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import React from 'react';
import { localSearch } from '@taskforceai/client-runtime/local-search';

import '../../../../../tests/setup/dom';
import type { ConversationStore } from '../platform/platform-interfaces';
import type { Message } from '../types';
import { useStreamingMessages } from './useStreamingMessages';

type StreamingOptions = Parameters<typeof useStreamingMessages>[0];

const addSearchItemMock = vi.fn();

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

vi.mock('../platform/PlatformProvider', () => ({
  useConversationStore: () => conversationStoreMock,
}));
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
  localSearch.addItem = addSearchItemMock as typeof localSearch.addItem;
  addSearchItemMock.mockImplementation(() => {});
  conversationStoreMock.upsertMessage.mockResolvedValue(undefined);
  conversationStoreMock.subscribe.mockReturnValue(() => {});
});

describe('useStreamingMessages web adapter', () => {
  it('creates persisted status and content placeholders', async () => {
    const { result } = renderStreamingHook();

    await waitFor(() => expect(result.current.streamingState.streamingMessageId).not.toBeNull());

    expect(result.current.messages).toHaveLength(2);
    const statusMessage = result.current.messages.find((message) => message.isAgentStatus);
    const contentMessage = result.current.messages.find((message) => !message.isAgentStatus);
    expect(conversationStoreMock.upsertMessage).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: statusMessage?.id, isAgentStatus: true })
    );
    expect(conversationStoreMock.upsertMessage).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: contentMessage?.id, isAgentStatus: false })
    );
  });

  it('persists final responses and indexes assistant content', async () => {
    const { result, rerender } = renderStreamingHook();

    await waitFor(() => expect(result.current.streamingState.streamingMessageId).not.toBeNull());
    const streamingMessageId = result.current.streamingState.streamingMessageId;
    await act(async () => {
      rerender(buildProps({ isStreaming: false, finalResponse: 'Done' }));
    });

    await waitFor(() =>
      expect(conversationStoreMock.upsertMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: streamingMessageId,
          content: 'Done',
          isStreaming: false,
        })
      )
    );
    expect(addSearchItemMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: streamingMessageId, content: 'Done' })
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

    await waitFor(() => expect(result.current.streamingState.streamingMessageId).not.toBeNull());
    const streamingMessageId = result.current.streamingState.streamingMessageId;
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
          messageId: streamingMessageId,
          content: 'Done',
          isStreaming: false,
          sources: [source],
        })
      )
    );
  });

  it('persists errors immediately and indexes the failed response', async () => {
    const { result, rerender } = renderStreamingHook();

    await waitFor(() => expect(result.current.streamingState.streamingMessageId).not.toBeNull());
    const streamingMessageId = result.current.streamingState.streamingMessageId;
    await act(async () => {
      rerender(buildProps({ isStreaming: false, errorMessage: 'Network failure' }));
    });

    await waitFor(() => expect(result.current.messages[1]?.content).toBe('Network failure'));
    expect(conversationStoreMock.upsertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: streamingMessageId,
        content: 'Network failure',
        isStreaming: false,
      })
    );
    expect(addSearchItemMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: streamingMessageId, content: 'Network failure' })
    );
  });
});
