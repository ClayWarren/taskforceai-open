import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import '../../../../../tests/setup/dom';

import { useSessionLifecycleController } from './useSessionLifecycleController';

describe('useSessionLifecycleController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resets streaming before starting a new chat and runs the host callback', async () => {
    const order: string[] = [];
    const { result } = renderHook(() =>
      useSessionLifecycleController({
        conversation: {
          handleNewChat: async () => {
            order.push('new-chat');
          },
          loadConversation: vi.fn(async () => undefined),
        },
        resetStreamingState: () => {
          order.push('reset');
        },
        afterNewChat: () => {
          order.push('after-new-chat');
        },
      })
    );

    await act(async () => {
      await result.current.handleNewChat();
    });

    expect(order).toEqual(['reset', 'new-chat', 'after-new-chat']);
  });

  it('loads a selected conversation and runs the host follow-up', async () => {
    const summary = {
      id: 1,
      user_input: 'hello',
      timestamp: new Date().toISOString(),
      result: 'done',
      model: 'remote-1',
    };
    const resetStreamingState = vi.fn();
    const loadConversation = vi.fn(async () => undefined);
    const afterConversationSelect = vi.fn(async () => undefined);

    const { result } = renderHook(() =>
      useSessionLifecycleController({
        conversation: {
          handleNewChat: vi.fn(async () => undefined),
          loadConversation,
        },
        resetStreamingState,
        afterConversationSelect,
      })
    );

    await act(async () => {
      await result.current.handleConversationSelect(summary);
    });

    expect(resetStreamingState).toHaveBeenCalledTimes(1);
    expect(loadConversation).toHaveBeenCalledWith(summary);
    expect(afterConversationSelect).toHaveBeenCalledWith(summary);
  });

  it('reports selection failures through the host error callback', async () => {
    const summary = {
      id: 1,
      user_input: 'hello',
      timestamp: new Date().toISOString(),
      result: 'done',
      model: 'remote-1',
    };
    const failure = new Error('load failed');
    const onConversationSelectError = vi.fn();

    const { result } = renderHook(() =>
      useSessionLifecycleController({
        conversation: {
          handleNewChat: vi.fn(async () => undefined),
          loadConversation: vi.fn(async () => {
            throw failure;
          }),
        },
        resetStreamingState: vi.fn(),
        onConversationSelectError,
      })
    );

    await act(async () => {
      await result.current.handleConversationSelect(summary);
    });

    expect(onConversationSelectError).toHaveBeenCalledWith(failure, summary);
  });

  it('loads a selected conversation without optional follow-up callbacks', async () => {
    const summary = {
      id: 2,
      user_input: 'follow-up',
      timestamp: new Date().toISOString(),
      result: 'done',
      model: 'remote-2',
    };
    const loadConversation = vi.fn(async () => undefined);

    const { result } = renderHook(() =>
      useSessionLifecycleController({
        conversation: {
          handleNewChat: vi.fn(async () => undefined),
          loadConversation,
        },
        resetStreamingState: vi.fn(),
      })
    );

    await act(async () => {
      await result.current.handleConversationSelect(summary);
    });

    expect(loadConversation).toHaveBeenCalledWith(summary);
  });

  it('builds shared message-session and pending-prompt adapters when messaging is provided', () => {
    const addUserMessage = vi.fn(async () => undefined);
    const ensureActiveConversation = vi.fn(async () => 'conv-123');
    const setMessages = vi.fn();
    const startStreaming = vi.fn(async () => undefined);
    const clearErrorMessage = vi.fn();
    const setErrorMessage = vi.fn();
    const invalidatePendingPrompts = vi.fn();

    const { result } = renderHook(() =>
      useSessionLifecycleController({
        conversation: {
          handleNewChat: vi.fn(async () => undefined),
          loadConversation: vi.fn(async () => undefined),
        },
        messaging: {
          conversation: {
            addUserMessage,
            ensureActiveConversation,
            setMessages,
          },
          streaming: {
            startStreaming,
            clearErrorMessage,
            setErrorMessage,
          },
        },
        resetStreamingState: vi.fn(),
        invalidatePendingPrompts,
      })
    );

    const { messageSession } = result.current;
    expect(messageSession).toBeDefined();
    if (!messageSession) {
      throw new Error('Expected message session to be initialized');
    }

    expect(messageSession.conversation.onSendMessage).toBe(addUserMessage);
    expect(messageSession.conversation.ensureConversationId).toBe(ensureActiveConversation);
    expect(messageSession.conversation.ensureActiveConversation).toBe(ensureActiveConversation);
    expect(messageSession.conversation.setMessages).toBe(setMessages);
    expect(messageSession.streaming).toEqual({
      startStreaming,
      clearErrorMessage,
      setErrorMessage,
    });
    expect(messageSession.invalidatePendingPrompts).toBe(invalidatePendingPrompts);
    expect(result.current.pendingPromptReplay).toEqual({
      startStreaming,
      invalidatePendingPrompts,
    });
  });

  it('omits optional follow-up adapters when messaging is absent', async () => {
    const conversation = {
      handleNewChat: vi.fn(),
      loadConversation: vi.fn(async () => undefined),
    };
    const resetStreamingState = vi.fn();

    const { result } = renderHook(() =>
      useSessionLifecycleController({
        conversation,
        resetStreamingState,
      })
    );

    expect(result.current.messageSession).toBeUndefined();
    expect(result.current.pendingPromptReplay).toBeUndefined();

    await act(async () => {
      await result.current.handleNewChat();
    });

    expect(resetStreamingState).toHaveBeenCalledTimes(1);
    expect(conversation.handleNewChat).toHaveBeenCalledTimes(1);
  });
});
