import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import '../../../tests/setup/dom';

import { usePendingPromptQueue, type PendingPromptQueueAdapter } from './usePendingPromptQueue';
import type { StartStreamingOptions } from './stores/createStreamingStore';
import type { PendingPromptRecord } from './types';

const createPrompt = (
  id: number,
  overrides: Partial<PendingPromptRecord> = {}
): PendingPromptRecord => ({
  id,
  conversationId: `conversation-${id}`,
  prompt: `prompt-${id}`,
  createdAt: 1000 + id,
  status: 'queued',
  ...overrides,
});

const createAdapter = (
  overrides: Partial<PendingPromptQueueAdapter> = {}
): PendingPromptQueueAdapter => ({
  listPendingPrompts: vi.fn().mockResolvedValue([]),
  updatePromptStatus: vi.fn().mockResolvedValue(undefined),
  removePrompt: vi.fn().mockResolvedValue(undefined),
  runTask: vi.fn().mockResolvedValue({ task_id: 'task-1' }),
  startStreaming: vi.fn().mockResolvedValue(undefined),
  invalidatePendingPrompts: vi.fn(),
  ...overrides,
});

describe('usePendingPromptQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      writable: true,
      value: true,
    });
  });

  it('does not process prompts while offline or while streaming', async () => {
    const listPendingPrompts = vi.fn().mockResolvedValue([createPrompt(1)]);
    const adapter = createAdapter({ listPendingPrompts });

    const offlineHook = renderHook(() =>
      usePendingPromptQueue({
        adapter,
        isOnline: false,
        isStreaming: false,
      })
    );

    await act(async () => {
      await offlineHook.result.current.processPendingPrompts();
    });

    expect(adapter.listPendingPrompts).not.toHaveBeenCalled();

    offlineHook.unmount();

    const streamingHook = renderHook(() =>
      usePendingPromptQueue({
        adapter,
        isOnline: true,
        isStreaming: true,
      })
    );

    await act(async () => {
      await streamingHook.result.current.processPendingPrompts();
    });

    expect(adapter.listPendingPrompts).not.toHaveBeenCalled();
  });

  it('retries retryable errors and resumes pending status before retrying', async () => {
    const prompt = createPrompt(11);
    const adapter = createAdapter({
      listPendingPrompts: vi.fn().mockResolvedValue([prompt]),
      runTask: vi
        .fn()
        .mockRejectedValueOnce({ status: 503, message: 'temporarily unavailable' })
        .mockResolvedValueOnce({ task_id: 'task-retry-success' }),
    });

    renderHook(() =>
      usePendingPromptQueue({
        adapter,
        isOnline: true,
        isStreaming: false,
        retryDelaysMs: [1],
      })
    );

    await waitFor(() => expect(adapter.startStreaming).toHaveBeenCalledTimes(1));

    expect(adapter.runTask).toHaveBeenCalledTimes(2);
    expect(adapter.runTask).toHaveBeenNthCalledWith(
      1,
      prompt.prompt,
      expect.objectContaining({
        idempotencyKey: `queue-${prompt.id}-${prompt.createdAt}`,
      })
    );
    expect(adapter.runTask).toHaveBeenNthCalledWith(
      2,
      prompt.prompt,
      expect.objectContaining({
        idempotencyKey: `queue-${prompt.id}-${prompt.createdAt}`,
      })
    );
    expect(adapter.updatePromptStatus).toHaveBeenNthCalledWith(1, prompt.id, 'pending');
    expect(adapter.updatePromptStatus).toHaveBeenNthCalledWith(2, prompt.id, 'queued');
    expect(adapter.updatePromptStatus).toHaveBeenNthCalledWith(3, prompt.id, 'pending');
  });

  it('marks prompt as failed on non-retryable errors', async () => {
    const prompt = createPrompt(12);
    const adapter = createAdapter({
      listPendingPrompts: vi.fn().mockResolvedValue([prompt]),
      runTask: vi.fn().mockRejectedValue({ status: 400, message: 'bad request' }),
    });

    renderHook(() =>
      usePendingPromptQueue({
        adapter,
        isOnline: true,
        isStreaming: false,
        retryDelaysMs: [1],
      })
    );

    await waitFor(() =>
      expect(adapter.updatePromptStatus).toHaveBeenCalledWith(prompt.id, 'failed')
    );

    expect(adapter.runTask).toHaveBeenCalledTimes(1);
    expect(adapter.updatePromptStatus).toHaveBeenNthCalledWith(1, prompt.id, 'pending');
    expect(adapter.updatePromptStatus).toHaveBeenNthCalledWith(2, prompt.id, 'failed');
    expect(adapter.startStreaming).not.toHaveBeenCalled();
  });

  it('retries empty task ids and fails after final retry', async () => {
    const prompt = createPrompt(13);
    const adapter = createAdapter({
      listPendingPrompts: vi.fn().mockResolvedValue([prompt]),
      runTask: vi.fn().mockResolvedValue({ task_id: '' }),
    });

    renderHook(() =>
      usePendingPromptQueue({
        adapter,
        isOnline: true,
        isStreaming: false,
        retryDelaysMs: [1],
      })
    );

    await waitFor(() =>
      expect(adapter.updatePromptStatus).toHaveBeenCalledWith(prompt.id, 'failed')
    );

    expect(adapter.runTask).toHaveBeenCalledTimes(2);
    expect(adapter.updatePromptStatus).toHaveBeenNthCalledWith(1, prompt.id, 'pending');
    expect(adapter.updatePromptStatus).toHaveBeenNthCalledWith(2, prompt.id, 'queued');
    expect(adapter.updatePromptStatus).toHaveBeenNthCalledWith(3, prompt.id, 'pending');
    expect(adapter.updatePromptStatus).toHaveBeenNthCalledWith(4, prompt.id, 'failed');
    expect(adapter.startStreaming).not.toHaveBeenCalled();
  });

  it('processes prompts sequentially and only advances after each prompt settles for launch', async () => {
    const first = createPrompt(21);
    const second = createPrompt(22);
    const adapter = createAdapter({
      listPendingPrompts: vi.fn().mockResolvedValue([first, second]),
      runTask: vi
        .fn()
        .mockRejectedValueOnce({ status: 400, message: 'invalid payload' })
        .mockResolvedValueOnce({ task_id: 'task-22' }),
    });

    renderHook(() =>
      usePendingPromptQueue({
        adapter,
        isOnline: true,
        isStreaming: false,
        retryDelaysMs: [],
      })
    );

    await waitFor(() => expect(adapter.startStreaming).toHaveBeenCalledTimes(1));

    expect(adapter.runTask).toHaveBeenNthCalledWith(
      1,
      first.prompt,
      expect.objectContaining({
        idempotencyKey: `queue-${first.id}-${first.createdAt}`,
      })
    );
    expect(adapter.runTask).toHaveBeenNthCalledWith(
      2,
      second.prompt,
      expect.objectContaining({
        idempotencyKey: `queue-${second.id}-${second.createdAt}`,
      })
    );
    expect(adapter.updatePromptStatus).toHaveBeenNthCalledWith(1, first.id, 'pending');
    expect(adapter.updatePromptStatus).toHaveBeenNthCalledWith(2, first.id, 'failed');
    expect(adapter.updatePromptStatus).toHaveBeenNthCalledWith(3, second.id, 'pending');
    expect(adapter.startStreaming).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-22',
        conversationId: second.conversationId,
        prompt: second.prompt,
      })
    );
  });

  it('removes queued prompts when stream settles with complete', async () => {
    const prompt = createPrompt(31);
    let onSettled: StartStreamingOptions['onSettled'];
    const adapter = createAdapter({
      listPendingPrompts: vi.fn().mockResolvedValue([prompt]),
      startStreaming: vi.fn().mockImplementation(async (options: StartStreamingOptions) => {
        onSettled = options.onSettled;
      }),
    });

    renderHook(() =>
      usePendingPromptQueue({
        adapter,
        isOnline: true,
        isStreaming: false,
      })
    );

    await waitFor(() => expect(adapter.startStreaming).toHaveBeenCalledTimes(1));
    expect(onSettled).toBeDefined();

    onSettled?.('complete');

    await waitFor(() => expect(adapter.removePrompt).toHaveBeenCalledWith(prompt.id));
    expect(adapter.invalidatePendingPrompts).toHaveBeenCalled();
  });

  it('marks queued prompts failed when stream settles with error', async () => {
    const prompt = createPrompt(32);
    let onSettled: StartStreamingOptions['onSettled'];
    const adapter = createAdapter({
      listPendingPrompts: vi.fn().mockResolvedValue([prompt]),
      startStreaming: vi.fn().mockImplementation(async (options: StartStreamingOptions) => {
        onSettled = options.onSettled;
      }),
    });

    renderHook(() =>
      usePendingPromptQueue({
        adapter,
        isOnline: true,
        isStreaming: false,
      })
    );

    await waitFor(() => expect(adapter.startStreaming).toHaveBeenCalledTimes(1));
    expect(onSettled).toBeDefined();

    onSettled?.('error');

    await waitFor(() =>
      expect(adapter.updatePromptStatus).toHaveBeenCalledWith(prompt.id, 'failed')
    );
    expect(adapter.removePrompt).not.toHaveBeenCalled();
    expect(adapter.invalidatePendingPrompts).toHaveBeenCalled();
  });

  it('returns queued prompts to queued status when stream settles with abort', async () => {
    const prompt = createPrompt(33);
    let onSettled: StartStreamingOptions['onSettled'];
    const adapter = createAdapter({
      listPendingPrompts: vi.fn().mockResolvedValue([prompt]),
      startStreaming: vi.fn().mockImplementation(async (options: StartStreamingOptions) => {
        onSettled = options.onSettled;
      }),
    });

    renderHook(() =>
      usePendingPromptQueue({
        adapter,
        isOnline: true,
        isStreaming: false,
      })
    );

    await waitFor(() => expect(adapter.startStreaming).toHaveBeenCalledTimes(1));
    expect(onSettled).toBeDefined();

    onSettled?.('abort');

    await waitFor(() =>
      expect(adapter.updatePromptStatus).toHaveBeenCalledWith(prompt.id, 'queued')
    );
    expect(adapter.removePrompt).not.toHaveBeenCalled();
    expect(adapter.invalidatePendingPrompts).toHaveBeenCalled();
  });

  it('passes queued attachment IDs and model IDs to runTask', async () => {
    const prompt = createPrompt(44, {
      runPayload: { modelId: 'openai/gpt-5.5', attachment_ids: ['att-1', 'att-2'] },
    });
    const adapter = createAdapter({
      listPendingPrompts: vi.fn().mockResolvedValue([prompt]),
      runTask: vi.fn().mockResolvedValue({ task_id: 'task-44' }),
    });

    renderHook(() =>
      usePendingPromptQueue({
        adapter,
        isOnline: true,
        isStreaming: false,
      })
    );

    await waitFor(() => expect(adapter.startStreaming).toHaveBeenCalledTimes(1));

    expect(adapter.runTask).toHaveBeenCalledWith(
      prompt.prompt,
      expect.objectContaining({
        modelId: 'openai/gpt-5.5',
        attachmentIds: ['att-1', 'att-2'],
      })
    );
  });

  it('does not retry prompts after network transitions offline during backoff', async () => {
    const prompt = createPrompt(55);
    const originalOnlineDescriptor = Object.getOwnPropertyDescriptor(navigator, 'onLine');
    try {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });

      let resolveQueuedStatus!: () => void;
      const queuedStatusReached = new Promise<void>((resolve) => {
        resolveQueuedStatus = resolve;
      });
      let hasResolvedQueuedStatus = false;

      const updatePromptStatus = vi.fn().mockImplementation(async (_id: number, status: string) => {
        if (status === 'queued' && !hasResolvedQueuedStatus) {
          hasResolvedQueuedStatus = true;
          resolveQueuedStatus();
        }
      });

      const adapter = createAdapter({
        listPendingPrompts: vi.fn().mockResolvedValue([prompt]),
        updatePromptStatus,
        runTask: vi
          .fn()
          .mockRejectedValueOnce({ status: 503, message: 'temporarily unavailable' })
          .mockResolvedValueOnce({ task_id: 'task-55' }),
      });

      const { rerender } = renderHook(
        (props: { isOnline: boolean }) =>
          usePendingPromptQueue({
            adapter,
            isOnline: props.isOnline,
            isStreaming: false,
            retryDelaysMs: [40],
          }),
        { initialProps: { isOnline: true } }
      );

      await queuedStatusReached;

      act(() => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
        rerender({ isOnline: false });
      });

      await new Promise((resolve) => {
        setTimeout(resolve, 80);
      });

      expect(adapter.runTask).toHaveBeenCalledTimes(1);
      expect(adapter.startStreaming).not.toHaveBeenCalled();
    } finally {
      if (originalOnlineDescriptor) {
        Object.defineProperty(navigator, 'onLine', originalOnlineDescriptor);
      } else {
        Object.defineProperty(navigator, 'onLine', {
          configurable: true,
          writable: true,
          value: true,
        });
      }
    }
  });
});
