import { act, renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';

import { useStreamingMessages, type MessagePersistence } from '../../hooks/useStreamingMessages';
import type { Message } from '../../types';

jest.mock('@taskforceai/shared/utils/id', () => {
  let counter = 0;
  return {
    createId: (prefix: string) => {
      counter += 1;
      return `${prefix}-${counter}`;
    },
  };
});

const createPersistence = (): jest.Mocked<MessagePersistence> => ({
  upsertMessage: jest.fn().mockResolvedValue(undefined),
  deleteMessage: jest.fn().mockResolvedValue(undefined),
});

const baseProps = (persistence: MessagePersistence) => ({
  isStreaming: true,
  streamContent: '',
  finalResponse: null,
  errorMessage: null,
  conversationId: 'conversation-1',
  ensureActiveConversation: jest.fn().mockResolvedValue('conversation-1'),
  setMessages: jest.fn(),
  sources: [],
  finalSources: [],
  toolEvents: [],
  finalToolEvents: [],
  elapsedSeconds: 0,
  agentStatuses: [],
  persistence,
});

const renderStreamingHook = (overrides: Partial<ReturnType<typeof baseProps>> = {}) => {
  const persistence = createPersistence();
  const props = { ...baseProps(persistence), ...overrides };

  const hook = renderHook(
    (nextProps: typeof props) => {
      const [messages, setMessages] = React.useState<Message[]>([]);
      const streamingState = useStreamingMessages({ ...nextProps, setMessages });
      return { messages, streamingState };
    },
    { initialProps: props }
  );

  return Object.assign(hook, { persistence, props });
};

describe('useStreamingMessages mobile adapter', () => {
  it('creates persisted status and content placeholders', async () => {
    const { result, persistence } = renderStreamingHook();

    await waitFor(() => expect(result.current.streamingState.streamingMessageId).toBe('assistant-2'));

    expect(result.current.messages).toHaveLength(2);
    expect(persistence.upsertMessage).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'assistant-1', isAgentStatus: true })
    );
    expect(persistence.upsertMessage).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'assistant-2', isAgentStatus: false })
    );
  });

  it('uses fresh placeholder timestamps for each stream', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000);
    const { result, rerender, persistence, props } = renderStreamingHook();

    try {
      await waitFor(() => expect(result.current.streamingState.streamingMessageId).not.toBeNull());

      await act(async () => {
        rerender({ ...props, isStreaming: false, finalResponse: 'First done' });
      });
      await waitFor(() => expect(result.current.streamingState.streamingMessageId).toBeNull());

      nowSpy.mockReturnValue(5000);
      await act(async () => {
        rerender({ ...props, isStreaming: true, finalResponse: null });
      });
      await waitFor(() => expect(result.current.streamingState.streamingMessageId).not.toBeNull());

      expect(persistence.upsertMessage).toHaveBeenCalledWith(
        expect.objectContaining({ createdAt: 1500, updatedAt: 1500 })
      );
      expect(persistence.upsertMessage).toHaveBeenCalledWith(
        expect.objectContaining({ createdAt: 2000, updatedAt: 2000 })
      );
      expect(persistence.upsertMessage).toHaveBeenCalledWith(
        expect.objectContaining({ createdAt: 5500, updatedAt: 5500 })
      );
      expect(persistence.upsertMessage).toHaveBeenCalledWith(
        expect.objectContaining({ createdAt: 6000, updatedAt: 6000 })
      );
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('persists final responses and resets streaming state', async () => {
    const { result, rerender, persistence, props } = renderStreamingHook();

    await waitFor(() => expect(result.current.streamingState.streamingMessageId).not.toBeNull());
    const streamingMessageId = result.current.streamingState.streamingMessageId;
    await act(async () => {
      rerender({ ...props, isStreaming: false, finalResponse: 'Done' });
    });

    await waitFor(() =>
      expect(persistence.upsertMessage).toHaveBeenCalledWith(
        expect.objectContaining({ messageId: streamingMessageId, content: 'Done', isStreaming: false })
      )
    );
    await waitFor(() => expect(result.current.streamingState.streamingMessageId).toBeNull());
  });

  it('persists error messages and resets streaming state', async () => {
    const { result, rerender, persistence, props } = renderStreamingHook();

    await waitFor(() => expect(result.current.streamingState.streamingMessageId).not.toBeNull());
    const streamingMessageId = result.current.streamingState.streamingMessageId;
    await act(async () => {
      rerender({ ...props, isStreaming: false, errorMessage: 'Network failure' });
    });

    await waitFor(() =>
      expect(persistence.upsertMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: streamingMessageId,
          content: 'Network failure',
          isStreaming: false,
        })
      )
    );
    await waitFor(() => expect(result.current.streamingState.streamingMessageId).toBeNull());
  });
});
