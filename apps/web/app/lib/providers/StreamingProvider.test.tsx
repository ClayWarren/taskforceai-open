import { act, cleanup, renderHook } from '@testing-library/react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import * as React from 'react';

import '../../../../../tests/setup/dom';

(window as any).env = { VITE_STREAMING_DEBUG: '0' };

import { handleStreamingPayload } from '@taskforceai/client-core/streaming/engine';
import { parseStreamingPayload } from '@taskforceai/client-core/streaming/schema';
import { useStreamingStore } from '../streaming/useStreamingStore';
import { StreamingProvider, useStreaming } from './StreamingProvider';

vi.mock('@taskforceai/client-core/streaming/engine', () => ({
  handleStreamingPayload: vi.fn(),
}));

vi.mock('@taskforceai/client-core/streaming/schema', () => ({
  parseStreamingPayload: vi.fn(),
}));

const streamFromChunks = (chunks: string[]): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

const pendingStream = (): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start() {},
  });

const originalFetch = globalThis.fetch;
const originalWindowFetch = window.fetch;
const fetchMock = vi.fn();
let latestFetchInit: RequestInit | null = null;

const installFetchMock = () => {
  const fetchLike = fetchMock as unknown as typeof fetch;
  globalThis.fetch = fetchLike;
  window.fetch = fetchLike;
};

installFetchMock();

describe('StreamingProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    latestFetchInit = null;
    fetchMock.mockImplementation(async (_input: string, init?: RequestInit) => {
      latestFetchInit = init ?? null;
      return new Response(pendingStream(), { status: 200 });
    });
    installFetchMock();
    useStreamingStore.getState().reset();
  });

  afterEach(() => {
    cleanup();
    useStreamingStore.getState().reset();
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    window.fetch = originalWindowFetch;
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

    await act(async () => {
      await result.current.startStreaming({
        taskId: 'task-1',
        conversationId: 'conv-1',
        prompt: 'test',
      });
    });

    expect(result.current.isStreaming).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/stream/task-1', expect.anything());
  });

  it('handles runtime start error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Connection failed'));
    const { result } = renderHook(() => useStreaming(), { wrapper });

    await act(async () => {
      try {
        await result.current.startStreaming({
          taskId: 'task-fail',
          conversationId: 'conv-1',
          prompt: 'test',
        });
      } catch {
        // Expected.
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
    fetchMock.mockImplementation(async (_input: string, init?: RequestInit) => {
      latestFetchInit = init ?? null;
      return new Response(streamFromChunks(['data: {"type":"progress"}\n\n']), { status: 200 });
    });
    const { result } = renderHook(() => useStreaming(), { wrapper });

    await act(async () => {
      await result.current.startStreaming({
        taskId: 'task-msg',
        conversationId: 'conv-1',
        prompt: 'test',
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(handleStreamingPayload).toHaveBeenCalled();
  });

  it('stops streaming', async () => {
    const { result } = renderHook(() => useStreaming(), { wrapper });

    await act(async () => {
      await result.current.startStreaming({
        taskId: 'task-stop',
        conversationId: 'conv-1',
        prompt: 'test',
      });
    });

    expect(result.current.isStreaming).toBe(true);

    act(() => {
      result.current.stopStreaming();
    });

    expect(result.current.isStreaming).toBe(false);
    expect((latestFetchInit?.signal as AbortSignal | undefined)?.aborted).toBe(true);
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
