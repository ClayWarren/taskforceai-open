import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createQueuedRunPayload } from '@taskforceai/client-runtime';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { usePendingPromptQueue } from '../hooks/usePendingPromptQueue';
import { listPendingPrompts, removePrompt, updatePromptStatus } from '../storage/chat-local-mobile';
import type { StartStreamingOptions } from '../streaming/useStreamingStore';
import type { PendingPrompt } from '../storage/chat-local-mobile.internal';

jest.mock('../logger', () => ({
  mobileLogger: {
    child: () => ({
      error: jest.fn(),
      warn: jest.fn(),
    }),
  },
}));

const flushMicrotasks = () =>
  act(async () => {
    await Promise.resolve();
  });

jest.mock('../storage/chat-local-mobile', () => ({
  listPendingPrompts: jest.fn<() => Promise<{ ok: true, value: PendingPrompt[] } | { ok: false, error: Error }>>().mockResolvedValue({ ok: true, value: [] }),
  removePrompt: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  updatePromptStatus: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
}));

type RunTaskResponse = {
  task_id: string;
  cached?: boolean | null;
  result?: string | null;
  conversation_id?: string | null;
};

type PendingQueueOptions = {
  isOnline: boolean;
  isStreaming: boolean;
  startStreaming: (options: StartStreamingOptions) => Promise<void>;
  invalidatePendingPrompts?: () => void;
};

const mockRunTask = jest.fn<
  (input: {
    prompt: string;
    demo?: boolean;
    modelId?: string;
    attachment_ids?: string[];
    options?: Record<string, unknown>;
  }) => Promise<RunTaskResponse>
>();

jest.mock('../api/client', () => ({
  getMobileClient: () => ({
    runTask: mockRunTask,
  }),
}));

const renderUsePendingPromptQueue = (options: PendingQueueOptions) => {
  let hookValue: ReturnType<typeof usePendingPromptQueue> | null = null;

  const Wrapper: React.FC<{ opts: PendingQueueOptions }> = ({ opts }) => {
    hookValue = usePendingPromptQueue(opts);
    return null;
  };

  let renderer: TestRenderer.ReactTestRenderer | null = null;
  act(() => {
    renderer = TestRenderer.create(<Wrapper opts={options} />);
  });

  if (!hookValue || !renderer) {
    throw new Error('Hook did not initialize');
  }

  const rerender = (nextOptions: PendingQueueOptions) => {
    act(() => {
      renderer!.update(<Wrapper opts={nextOptions} />);
    });
  };

  const cleanup = () => {
    act(() => {
      renderer?.unmount();
    });
  };

  const getHook = () => {
    if (!hookValue) {
      throw new Error('Hook is unavailable');
    }
    return hookValue;
  };

  return { getHook, rerender, cleanup };
};

const listPendingPromptsMock = jest.mocked(listPendingPrompts);
const removePromptMock = jest.mocked(removePrompt);
const updatePromptStatusMock = jest.mocked(updatePromptStatus);

const buildPendingPrompt = (
  overrides: Partial<PendingPrompt>
): PendingPrompt => ({
  id: 1,
  conversationId: 'conv-1',
  prompt: 'Queued prompt',
  status: 'queued',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides,
});

describe('usePendingPromptQueue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    listPendingPromptsMock.mockResolvedValue({ ok: true, value: [] });
    mockRunTask.mockReset();
  });

  it('no-ops when offline', async () => {
    const startStreaming = jest.fn<(options: StartStreamingOptions) => Promise<void>>();
    const { getHook, cleanup } = renderUsePendingPromptQueue({
      isOnline: false,
      isStreaming: false,
      startStreaming,
    });

    await getHook().processPendingPrompts();
    expect(listPendingPromptsMock).not.toHaveBeenCalled();
    cleanup();
  });

  it('processes queued prompts end-to-end', async () => {
    listPendingPromptsMock.mockResolvedValueOnce({
      ok: true, value: [
        buildPendingPrompt({ id: 1, conversationId: 'conv-1', prompt: 'Queued prompt' }),
      ]
    });
    listPendingPromptsMock.mockResolvedValue({ ok: true, value: [] });
    const startStreaming = jest
      .fn<(options: StartStreamingOptions) => Promise<void>>()
      .mockResolvedValue(undefined);
    mockRunTask.mockResolvedValue({ task_id: 'task-1' });
    const invalidatePendingPrompts = jest.fn();

    const { cleanup } = renderUsePendingPromptQueue({
      isOnline: true,
      isStreaming: false,
      startStreaming,
      invalidatePendingPrompts,
    });

    await flushMicrotasks();
    await flushMicrotasks();

    expect(updatePromptStatusMock).toHaveBeenCalledWith(1, 'pending');
    expect(mockRunTask).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Queued prompt',
        demo: false,
        options: expect.objectContaining({
          idempotencyKey: expect.any(String),
        }),
      })
    );
    expect(startStreaming).toHaveBeenCalledWith({
      taskId: 'task-1',
      conversationId: 'conv-1',
      prompt: 'Queued prompt',
      onSettled: expect.any(Function),
    });
    const settle = startStreaming.mock.calls[0]?.[0]?.onSettled;
    expect(typeof settle).toBe('function');
    await act(async () => {
      if (settle) {
        settle('complete');
      }
    });
    expect(removePromptMock).toHaveBeenCalledWith(1);
    expect(invalidatePendingPrompts).toHaveBeenCalledTimes(2);
    cleanup();
  });

  it('updates prompt when streaming ends with error', async () => {
    listPendingPromptsMock.mockResolvedValue({
      ok: true, value: [
        buildPendingPrompt({ id: 9, conversationId: 'conv-9', prompt: 'Process me' }),
      ]
    });
    const startStreaming = jest
      .fn<(options: StartStreamingOptions) => Promise<void>>()
      .mockResolvedValue(undefined);
    mockRunTask.mockResolvedValue({ task_id: 'task-err' });

    const { cleanup } = renderUsePendingPromptQueue({
      isOnline: true,
      isStreaming: false,
      startStreaming,
    });

    await flushMicrotasks();
    const settle = startStreaming.mock.calls[0]?.[0]?.onSettled;
    await act(async () => {
      if (settle) {
        settle('error');
      }
    });

    expect(updatePromptStatusMock).toHaveBeenCalledWith(9, 'failed');
    expect(removePromptMock).not.toHaveBeenCalled();
    await flushMicrotasks();
    cleanup();
  });

  it('marks prompt as failed when runTask throws', async () => {
    listPendingPromptsMock.mockResolvedValue({
      ok: true, value: [
        buildPendingPrompt({ id: 7, conversationId: 'conv-7', prompt: 'Retry me' }),
      ]
    });
    const error = new Error('fatal error');
    const startStreaming = jest.fn<(options: StartStreamingOptions) => Promise<void>>();
    mockRunTask.mockRejectedValue(error);

    const { getHook, cleanup } = renderUsePendingPromptQueue({
      isOnline: true,
      isStreaming: false,
      startStreaming,
    });

    await getHook().processPendingPrompts();
    await flushMicrotasks();

    expect(updatePromptStatusMock).toHaveBeenCalledWith(7, 'pending');
    expect(updatePromptStatusMock).toHaveBeenCalledWith(7, 'failed');
    expect(removePromptMock).not.toHaveBeenCalled();
    cleanup();
  });

  it('auto-processes when coming online and idle', async () => {
    listPendingPromptsMock.mockResolvedValue({ ok: true, value: [] });
    const startStreaming = jest.fn<(options: StartStreamingOptions) => Promise<void>>();

    const { cleanup } = renderUsePendingPromptQueue({
      isOnline: true,
      isStreaming: false,
      startStreaming,
    });

    await flushMicrotasks();

    expect(listPendingPromptsMock).toHaveBeenCalled();
    cleanup();
  });

  it('forwards queued attachment IDs when replaying a pending prompt', async () => {
    listPendingPromptsMock.mockResolvedValueOnce({
      ok: true,
      value: [
        buildPendingPrompt({
          id: 17,
          prompt: 'Process file',
          runPayload: createQueuedRunPayload({
            prompt: 'Process file',
            attachmentIds: ['att-1', 'att-2'],
          }),
        }),
      ],
    });
    listPendingPromptsMock.mockResolvedValue({ ok: true, value: [] });
    const startStreaming = jest
      .fn<(options: StartStreamingOptions) => Promise<void>>()
      .mockResolvedValue(undefined);
    mockRunTask.mockResolvedValue({ task_id: 'task-17' });

    const { cleanup } = renderUsePendingPromptQueue({
      isOnline: true,
      isStreaming: false,
      startStreaming,
    });

    await flushMicrotasks();
    await flushMicrotasks();

    expect(mockRunTask).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Process file',
        attachment_ids: ['att-1', 'att-2'],
      })
    );
    cleanup();
  });
});
