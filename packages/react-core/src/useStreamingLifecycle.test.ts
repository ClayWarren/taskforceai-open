import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'bun:test';
import '../../../tests/setup/dom';

import { useStreamingLifecycle } from './useStreamingLifecycle';

const renderLifecycleHook = (
  overrides: Partial<Parameters<typeof useStreamingLifecycle>[0]> = {}
) =>
  renderHook((props: Parameters<typeof useStreamingLifecycle>[0]) => useStreamingLifecycle(props), {
    initialProps: {
      isStreaming: false,
      streamContent: '',
      finalResponse: null,
      errorMessage: null,
      conversationId: null,
      ensureActiveConversation: vi.fn().mockResolvedValue('conversation-1'),
      ...overrides,
    },
  });

describe('useStreamingLifecycle', () => {
  it('buffers content before placeholders and appends content after they are ready', async () => {
    const { result, rerender } = renderLifecycleHook({
      isStreaming: true,
      streamContent: 'early chunk',
    });

    await waitFor(() => expect(result.current.state.state).toBe('awaitingPlaceholder'));
    expect(result.current.state).toMatchObject({ bufferedContent: 'early chunk' });

    act(() => {
      result.current.dispatchPlaceholdersReady({
        statusMessageId: 'status-1',
        contentMessageId: 'content-1',
      });
    });

    expect(result.current.contentMessageId).toBe('content-1');
    expect(result.current.statusMessageId).toBe('status-1');
    expect(result.current.state).toMatchObject({
      state: 'streaming',
      bufferedContent: 'early chunk',
    });

    rerender({
      isStreaming: true,
      streamContent: 'next chunk',
      finalResponse: null,
      errorMessage: null,
      conversationId: null,
      ensureActiveConversation: vi.fn().mockResolvedValue('conversation-1'),
    });

    await waitFor(() =>
      expect(result.current.state).toMatchObject({ bufferedContent: 'next chunk' })
    );
  });

  it('can suppress prop-driven finalization and reset when idle', async () => {
    const { result, rerender } = renderLifecycleHook({
      isStreaming: true,
      dispatchFinalResponseOnProp: false,
      finalResponse: 'Done',
      resetWhenIdle: true,
    });

    await waitFor(() => expect(result.current.state.state).toBe('awaitingPlaceholder'));
    expect(result.current.state.state).not.toBe('finalizing');

    rerender({
      isStreaming: false,
      streamContent: '',
      finalResponse: null,
      errorMessage: null,
      conversationId: null,
      ensureActiveConversation: vi.fn().mockResolvedValue('conversation-1'),
      dispatchFinalResponseOnProp: false,
      resetWhenIdle: true,
    });

    await waitFor(() => expect(result.current.state.state).toBe('idle'));
  });

  it('dispatches prop-driven final responses when enabled', async () => {
    const { result } = renderLifecycleHook({
      isStreaming: true,
      finalResponse: 'Done',
    });

    await waitFor(() => expect(result.current.state.state).toBe('finalizing'));
    expect(result.current.state.state).toBe('finalizing');
    if (result.current.state.state === 'finalizing') {
      expect(result.current.state.finalResponse).toBe('Done');
    }
  });

  it('exposes an append-content dispatcher', async () => {
    const { result } = renderLifecycleHook({ isStreaming: true });

    await waitFor(() => expect(result.current.state.state).toBe('awaitingPlaceholder'));

    act(() => {
      result.current.dispatchPlaceholdersReady({
        statusMessageId: 'status-1',
        contentMessageId: 'content-1',
      });
      result.current.dispatchAppendContent('manual chunk');
    });

    expect(result.current.state).toMatchObject({
      state: 'streaming',
      bufferedContent: 'manual chunk',
    });
  });

  it('resolves an existing conversation id before creating one', async () => {
    const ensureActiveConversation = vi.fn().mockResolvedValue('created-conversation');
    const { result, rerender } = renderLifecycleHook({
      conversationId: 'existing-conversation',
      ensureActiveConversation,
    });

    await expect(result.current.resolveConversationId()).resolves.toBe('existing-conversation');
    expect(ensureActiveConversation).not.toHaveBeenCalled();

    rerender({
      isStreaming: false,
      streamContent: '',
      finalResponse: null,
      errorMessage: null,
      conversationId: null,
      ensureActiveConversation,
    });

    await expect(result.current.resolveConversationId()).resolves.toBe('created-conversation');
    expect(ensureActiveConversation).toHaveBeenCalledTimes(1);
  });
});
