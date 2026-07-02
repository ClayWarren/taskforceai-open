import '../../../../../tests/setup/dom';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

const useConversationStoreMock = vi.fn();
const loggerErrorMock = vi.fn();

vi.mock('../platform/PlatformProvider', () => ({
  useConversationStore: useConversationStoreMock,
}));

vi.mock('../logger', () => ({
  logger: {
    error: loggerErrorMock,
  },
}));

import { useStreamingPersistenceQueues } from './useStreamingPersistenceQueues';

describe('useStreamingPersistenceQueues', () => {
  const conversationStore = {
    upsertMessage: vi.fn(),
  };
  const ensureActiveConversation = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    conversationStore.upsertMessage.mockResolvedValue(undefined);
    ensureActiveConversation.mockResolvedValue('active-conversation');
    useConversationStoreMock.mockReturnValue(conversationStore);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('queues and flushes assistant content writes with optional metadata', async () => {
    const { result } = renderHook(() =>
      useStreamingPersistenceQueues({ ensureActiveConversation })
    );

    await act(async () => {
      result.current.appendQueuedContentWrite({
        messageId: 'message-1',
        conversationId: 'conversation-1',
        content: 'partial answer',
        isStreaming: true,
        error: null,
        sources: [{ title: 'Doc', url: 'https://example.com' } as never],
        isAgentStatus: false,
      });
      await result.current.flushPendingDbWritesImmediately();
    });

    expect(conversationStore.upsertMessage).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      messageId: 'message-1',
      role: 'assistant',
      content: 'partial answer',
      isStreaming: true,
      error: null,
      sources: [{ title: 'Doc', url: 'https://example.com' }],
      isAgentStatus: false,
    });
  });

  it('resolves the active conversation before persisting tool events without an id', async () => {
    const { result } = renderHook(() =>
      useStreamingPersistenceQueues({ ensureActiveConversation })
    );

    await act(async () => {
      result.current.appendQueuedToolEventsWrite({
        messageId: 'status-1',
        conversationId: null,
        toolEvents: [{ id: 'tool-1', name: 'search' } as never],
      });
      await result.current.flushPendingToolEventsWritesImmediately();
    });

    expect(ensureActiveConversation).toHaveBeenCalled();
    expect(conversationStore.upsertMessage).toHaveBeenCalledWith({
      conversationId: 'active-conversation',
      messageId: 'status-1',
      role: 'assistant',
      content: '',
      isStreaming: true,
      isAgentStatus: true,
      sources: [],
      toolEvents: [{ id: 'tool-1', name: 'search' }],
    });
  });

  it('does not persist resolved tool events after unmount', async () => {
    let resolveConversation: (conversationId: string) => void = () => {};
    ensureActiveConversation.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveConversation = resolve;
      })
    );
    const { result, unmount } = renderHook(() =>
      useStreamingPersistenceQueues({ ensureActiveConversation })
    );

    act(() => {
      result.current.appendQueuedToolEventsWrite({
        messageId: 'status-1',
        conversationId: null,
        toolEvents: [],
      });
    });
    const flushPromise = result.current.flushPendingToolEventsWritesImmediately();
    await Promise.resolve();
    unmount();
    resolveConversation('late-conversation');
    await flushPromise;

    expect(conversationStore.upsertMessage).not.toHaveBeenCalled();
  });

  it('disposes queued writes and logs persistence failures', async () => {
    const writeError = new Error('write failed');
    conversationStore.upsertMessage.mockRejectedValueOnce(writeError);
    const { result } = renderHook(() =>
      useStreamingPersistenceQueues({ ensureActiveConversation })
    );

    result.current.appendQueuedContentWrite({
      messageId: 'message-1',
      conversationId: 'conversation-1',
      content: 'will fail',
      isStreaming: true,
      error: null,
    });
    await act(async () => {
      await result.current.flushPendingDbWritesImmediately();
    });

    result.current.appendQueuedToolEventsWrite({
      messageId: 'status-1',
      conversationId: 'conversation-1',
      toolEvents: [],
    });
    result.current.disposeStreamingPersistenceQueues();
    await act(async () => {
      await result.current.flushPendingToolEventsWritesImmediately();
      vi.advanceTimersByTime(500);
    });

    expect(loggerErrorMock).toHaveBeenCalledWith(
      '[useStreamingMessages] Failed to flush pending message',
      { error: writeError }
    );
    expect(conversationStore.upsertMessage).toHaveBeenCalledTimes(1);
  });
});
