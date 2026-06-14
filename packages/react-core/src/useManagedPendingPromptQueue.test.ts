import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import '../../../tests/setup/dom';

import { useManagedPendingPromptQueue } from './useManagedPendingPromptQueue';
import type { PendingPromptQueueStorageAdapter } from './pendingPromptQueueAdapter';
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
  runPayload: {
    prompt: `prompt-${id}`,
    conversationId: `conversation-${id}`,
    modelId: `model-${id}`,
    attachmentIds: [`attachment-${id}`],
  },
  ...overrides,
});

const createStorage = (
  overrides: Partial<PendingPromptQueueStorageAdapter> = {}
): PendingPromptQueueStorageAdapter => ({
  listPendingPrompts: vi.fn().mockResolvedValue([]),
  updatePromptStatus: vi.fn().mockResolvedValue(undefined),
  removePrompt: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

describe('useManagedPendingPromptQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    });
  });

  it('adapts storage, runTask, streaming, and invalidation through stable refs', async () => {
    const prompt = createPrompt(1);
    const storage = createStorage({
      listPendingPrompts: vi.fn().mockResolvedValue([prompt]),
    });
    const runTask = vi.fn().mockResolvedValue({ task_id: 'task-1' });
    const startStreaming = vi.fn().mockResolvedValue(undefined);
    const invalidatePendingPrompts = vi.fn();

    const { result, rerender } = renderHook(
      ({
        currentStorage,
        currentRunTask,
        currentStartStreaming,
        currentInvalidatePendingPrompts,
      }: {
        currentStorage: PendingPromptQueueStorageAdapter;
        currentRunTask: typeof runTask;
        currentStartStreaming: typeof startStreaming;
        currentInvalidatePendingPrompts: typeof invalidatePendingPrompts;
      }) =>
        useManagedPendingPromptQueue({
          storage: currentStorage,
          runTask: currentRunTask,
          startStreaming: currentStartStreaming,
          invalidatePendingPrompts: currentInvalidatePendingPrompts,
          isOnline: true,
          isStreaming: false,
          retryDelaysMs: [1],
        }),
      {
        initialProps: {
          currentStorage: storage,
          currentRunTask: runTask,
          currentStartStreaming: startStreaming,
          currentInvalidatePendingPrompts: invalidatePendingPrompts,
        },
      }
    );

    await waitFor(() =>
      expect(runTask).toHaveBeenCalledWith({
        prompt: 'prompt-1',
        demo: false,
        modelId: 'model-1',
        attachment_ids: ['attachment-1'],
        options: { idempotencyKey: 'queue-1-1001' },
      })
    );
    expect(startStreaming).toHaveBeenCalledWith({
      taskId: 'task-1',
      conversationId: 'conversation-1',
      prompt: 'prompt-1',
      onSettled: expect.any(Function),
    });
    expect(storage.updatePromptStatus).toHaveBeenCalledWith(1, 'pending');
    await act(async () => {
      await startStreaming.mock.calls[0]?.[0].onSettled?.('complete');
    });
    expect(storage.removePrompt).toHaveBeenCalledWith(1);
    expect(invalidatePendingPrompts).toHaveBeenCalled();

    const nextPrompt = createPrompt(2);
    const nextStorage = createStorage({
      listPendingPrompts: vi.fn().mockResolvedValue([nextPrompt]),
    });
    const nextRunTask = vi.fn().mockResolvedValue({ task_id: 'task-2' });
    const nextStartStreaming = vi.fn().mockResolvedValue(undefined);
    const nextInvalidatePendingPrompts = vi.fn();

    rerender({
      currentStorage: nextStorage,
      currentRunTask: nextRunTask,
      currentStartStreaming: nextStartStreaming,
      currentInvalidatePendingPrompts: nextInvalidatePendingPrompts,
    });

    await act(async () => {
      await result.current.processPendingPrompts();
    });

    expect(nextRunTask).toHaveBeenCalledWith({
      prompt: 'prompt-2',
      demo: false,
      modelId: 'model-2',
      attachment_ids: ['attachment-2'],
      options: { idempotencyKey: 'queue-2-1002' },
    });
    expect(nextStartStreaming).toHaveBeenCalledWith({
      taskId: 'task-2',
      conversationId: 'conversation-2',
      prompt: 'prompt-2',
      onSettled: expect.any(Function),
    });
    await act(async () => {
      await nextStartStreaming.mock.calls[0]?.[0].onSettled?.('complete');
    });
    expect(nextInvalidatePendingPrompts).toHaveBeenCalled();
  });

  it('does not process while offline or streaming', async () => {
    const storage = createStorage({
      listPendingPrompts: vi.fn().mockResolvedValue([createPrompt(3)]),
    });

    const { result, rerender } = renderHook(
      ({ isOnline, isStreaming }: { isOnline: boolean; isStreaming: boolean }) =>
        useManagedPendingPromptQueue({
          storage,
          runTask: vi.fn().mockResolvedValue({ task_id: 'task-3' }),
          startStreaming: vi.fn().mockResolvedValue(undefined),
          isOnline,
          isStreaming,
        }),
      { initialProps: { isOnline: false, isStreaming: false } }
    );

    await act(async () => {
      await result.current.processPendingPrompts();
    });

    rerender({ isOnline: true, isStreaming: true });

    await act(async () => {
      await result.current.processPendingPrompts();
    });

    expect(storage.listPendingPrompts).not.toHaveBeenCalled();
  });

  it('works without an invalidation callback', async () => {
    const prompt = createPrompt(4);
    const storage = createStorage({
      listPendingPrompts: vi.fn().mockResolvedValue([prompt]),
    });
    const runTask = vi.fn().mockResolvedValue({ task_id: 'task-4' });
    const startStreaming = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useManagedPendingPromptQueue({
        storage,
        runTask,
        startStreaming,
        isOnline: true,
        isStreaming: false,
        retryDelaysMs: [1],
      })
    );

    await act(async () => {
      await result.current.processPendingPrompts();
    });

    expect(runTask).toHaveBeenCalled();
    await act(async () => {
      await startStreaming.mock.calls[0]?.[0].onSettled?.('complete');
    });
    expect(storage.removePrompt).toHaveBeenCalledWith(4);
  });
});
