import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import '../../../../../tests/setup/dom';

import { useConversationSessionActions } from './useConversationSessionActions';

describe('useConversationSessionActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resets streaming before starting a new chat and runs the host callback', async () => {
    const order: string[] = [];
    const { result } = renderHook(() =>
      useConversationSessionActions({
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

  it('delegates new chat actions through the lifecycle controller wrapper', async () => {
    const handleNewChat = vi.fn(async () => undefined);

    const { result } = renderHook(() =>
      useConversationSessionActions({
        conversation: {
          handleNewChat,
          loadConversation: vi.fn(async () => undefined),
        },
        resetStreamingState: vi.fn(),
      })
    );

    await act(async () => {
      await result.current.handleNewChat();
    });

    expect(handleNewChat).toHaveBeenCalledTimes(1);
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
      useConversationSessionActions({
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
      useConversationSessionActions({
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

  it('forwards every lifecycle option through the session wrapper', async () => {
    const summary = {
      id: 2,
      user_input: 'follow-up',
      timestamp: new Date().toISOString(),
      result: 'done',
      model: 'remote-2',
    };
    const afterNewChat = vi.fn(async () => undefined);
    const afterConversationSelect = vi.fn(async () => undefined);
    const onConversationSelectError = vi.fn();

    const { result } = renderHook(() =>
      useConversationSessionActions({
        conversation: {
          handleNewChat: vi.fn(async () => undefined),
          loadConversation: vi.fn(async () => undefined),
        },
        resetStreamingState: vi.fn(),
        afterNewChat,
        afterConversationSelect,
        onConversationSelectError,
      })
    );

    await act(async () => {
      await result.current.handleNewChat();
      await result.current.handleConversationSelect(summary);
    });

    expect(afterNewChat).toHaveBeenCalledTimes(1);
    expect(afterConversationSelect).toHaveBeenCalledWith(summary);
  });
});
