import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, mock } from 'bun:test';
import * as React from 'react';

import '../../../../../tests/setup/dom';

// Mock fetchEventSource
type FetchEventSourceOptions = {
  signal?: AbortSignal;
  onopen?: (response: Response) => Promise<void>;
  onmessage?: (event: { data: string }) => void;
  onerror?: (error: Error) => void;
};

let latestOptions: FetchEventSourceOptions | null = null;
const mockFetchEventSource = mock((_: string, options: FetchEventSourceOptions) => {
  latestOptions = options;
  return new Promise<void>(() => {}); // Never resolves by default
});

vi.mock('@microsoft/fetch-event-source', () => ({
  fetchEventSource: mockFetchEventSource,
}));

(window as any).env = { VITE_STREAMING_DEBUG: '0' };

import { handleStreamingPayload } from '@taskforceai/shared/streaming/engine';
import { parseStreamingPayload } from '@taskforceai/shared/streaming/schema';
import { useStreamingStore } from '../streaming/useStreamingStore';
import { StreamingProvider, useStreaming } from './StreamingProvider';

vi.mock('@taskforceai/shared/streaming/engine', () => ({
  handleStreamingPayload: vi.fn(),
}));

vi.mock('@taskforceai/shared/streaming/schema', () => ({
  parseStreamingPayload: vi.fn(),
}));

describe('StreamingProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchEventSource.mockClear();
    latestOptions = null;
    useStreamingStore.getState().reset();
  });

  afterEach(() => {
    cleanup();
    useStreamingStore.getState().reset();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <StreamingProvider>{children}</StreamingProvider>
  );

  it('provides initial state', () => {
    const { result } = renderHook(() => useStreaming(), { wrapper });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.streamContent).toBe('');
    expect(result.current.sources).toEqual([]);
    expect(result.current.errorMessage).toBeNull();
  });

  it('startStreaming invokes runtime and sets loading state', async () => {
    const { result } = renderHook(() => useStreaming(), { wrapper });

    let startPromise: Promise<void>;
    await act(async () => {
      startPromise = result.current.startStreaming({
        taskId: 'task-1',
        conversationId: 'conv-1',
        prompt: 'test',
      });

      // Simulate connection opening
      if (latestOptions?.onopen) {
        await latestOptions.onopen(new Response('', { status: 200 }));
      }
      await startPromise;
    });

    expect(result.current.isStreaming).toBe(true);
    expect(mockFetchEventSource).toHaveBeenCalledWith('/api/v1/stream/task-1', expect.anything());
  });

  it('handles runtime start error', async () => {
    const { result } = renderHook(() => useStreaming(), { wrapper });

    await act(async () => {
      const startPromise = result.current.startStreaming({
        taskId: 'task-fail',
        conversationId: 'conv-1',
        prompt: 'test',
      });

      // Simulate error
      if (latestOptions?.onerror) {
        try {
          latestOptions.onerror(new Error('Connection failed'));
        } catch {
          // Expected throw in some implementations to stop retry
        }
      }

      try {
        await startPromise;
      } catch {
        // Expected
      }
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.errorMessage).toBe('Streaming failed');
  });

  it('processes incoming messages', async () => {
    (parseStreamingPayload as any).mockReturnValue({
      ok: true,
      value: { type: 'progress' },
    });

    const { result } = renderHook(() => useStreaming(), { wrapper });

    await act(async () => {
      const startPromise = result.current.startStreaming({
        taskId: 'task-msg',
        conversationId: 'conv-1',
        prompt: 'test',
      });

      if (latestOptions?.onopen) {
        await latestOptions.onopen(new Response('', { status: 200 }));
      }
      await startPromise;
    });

    await act(async () => {
      if (latestOptions?.onmessage) {
        latestOptions.onmessage({ data: JSON.stringify({ type: 'progress' }) });
      }
    });

    expect(handleStreamingPayload).toHaveBeenCalled();
  });

  it('stops streaming', async () => {
    const { result } = renderHook(() => useStreaming(), { wrapper });

    await act(async () => {
      const startPromise = result.current.startStreaming({
        taskId: 'task-stop',
        conversationId: 'conv-1',
        prompt: 'test',
      });

      if (latestOptions?.onopen) {
        await latestOptions.onopen(new Response('', { status: 200 }));
      }
      await startPromise;
    });

    expect(result.current.isStreaming).toBe(true);

    act(() => {
      result.current.stopStreaming();
    });

    expect(result.current.isStreaming).toBe(false);
    expect(latestOptions?.signal?.aborted).toBe(true);
  });

  it('clears error message', () => {
    const { result } = renderHook(() => useStreaming(), { wrapper });
    act(() => {
      result.current.setErrorMessage('Some error');
    });
    expect(result.current.errorMessage).toBe('Some error');

    act(() => {
      result.current.clearErrorMessage();
    });
    expect(result.current.errorMessage).toBeNull();
  });
});
