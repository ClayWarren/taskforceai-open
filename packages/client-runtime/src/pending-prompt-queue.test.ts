import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { ApiClientError } from '@taskforceai/contracts/client';

import { PendingPromptQueueProcessor } from './pending-prompt-queue';
import type { PendingPromptQueueAdapter } from './pending-prompt-queue';
import type { PendingPromptRecord } from './types';

const createPrompt = (overrides: Partial<PendingPromptRecord> = {}): PendingPromptRecord => ({
  id: 1,
  conversationId: 'local-conversation',
  prompt: 'retry me',
  createdAt: 123,
  status: 'queued',
  ...overrides,
});

const createAdapter = (
  overrides: Partial<PendingPromptQueueAdapter> = {}
): PendingPromptQueueAdapter => ({
  listPendingPrompts: vi.fn().mockResolvedValue([createPrompt()]),
  updatePromptStatus: vi.fn().mockResolvedValue(undefined),
  removePrompt: vi.fn().mockResolvedValue(undefined),
  runTask: vi.fn().mockResolvedValue({ task_id: 'task-1' }),
  startStreaming: vi.fn().mockResolvedValue(undefined),
  invalidatePendingPrompts: vi.fn(),
  ...overrides,
});

const createLogger = () => ({
  warn: vi.fn(),
  error: vi.fn(),
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PendingPromptQueueProcessor', () => {
  it('skips processing while inactive, offline, streaming, or navigator offline', async () => {
    const adapter = createAdapter();
    const processor = new PendingPromptQueueProcessor({
      adapter,
      logger: createLogger(),
      isNavigatorOnline: () => false,
    });

    processor.setEnvironment({ isOnline: true, isStreaming: false });
    await processor.processPendingPrompts();
    processor.setActive(false);
    await processor.processPendingPrompts();

    expect(adapter.listPendingPrompts).not.toHaveBeenCalled();
  });

  it('ignores pending records without numeric ids', async () => {
    const adapter = createAdapter({
      listPendingPrompts: vi.fn().mockResolvedValue([createPrompt({ id: undefined })]),
    });
    const processor = new PendingPromptQueueProcessor({ adapter, logger: createLogger() });
    processor.setEnvironment({ isOnline: true, isStreaming: false });

    await processor.processPendingPrompts();

    expect(adapter.updatePromptStatus).not.toHaveBeenCalled();
    expect(adapter.runTask).not.toHaveBeenCalled();
  });

  it('passes queued run metadata to runTask and removes prompt on completion settlement', async () => {
    let onSettled: ((reason: 'complete') => void) | undefined;
    const adapter = createAdapter({
      listPendingPrompts: vi.fn().mockResolvedValue([
        createPrompt({
          runPayload: { modelId: 'model-1', attachment_ids: ['file-1'] },
        }),
      ]),
      startStreaming: vi.fn().mockImplementation((options) => {
        onSettled = options.onSettled;
        return Promise.resolve();
      }),
    });
    const processor = new PendingPromptQueueProcessor({ adapter, logger: createLogger() });
    processor.setEnvironment({ isOnline: true, isStreaming: false });

    await processor.processPendingPrompts();
    onSettled?.('complete');
    await Promise.resolve();

    expect(adapter.runTask).toHaveBeenCalledWith('retry me', {
      idempotencyKey: 'queue-1-123',
      runPayload: { modelId: 'model-1', attachment_ids: ['file-1'] },
      modelId: 'model-1',
      attachmentIds: ['file-1'],
    });
    expect(adapter.removePrompt).toHaveBeenCalledWith(1);
    expect(adapter.invalidatePendingPrompts).toHaveBeenCalled();
  });

  it('marks prompt queued if environment changes after pending status is set', async () => {
    const adapter = createAdapter();
    const processor = new PendingPromptQueueProcessor({ adapter, logger: createLogger() });
    processor.setEnvironment({ isOnline: true, isStreaming: false });
    (adapter.updatePromptStatus as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      processor.setEnvironment({ isOnline: false, isStreaming: false });
    });

    await processor.processPendingPrompts();

    expect(adapter.updatePromptStatus).toHaveBeenCalledWith(1, 'pending');
    expect(adapter.updatePromptStatus).toHaveBeenCalledWith(1, 'queued');
    expect(adapter.runTask).not.toHaveBeenCalled();
  });

  it('logs finalization failures without throwing', async () => {
    let onSettled: ((reason: 'error') => void) | undefined;
    const logger = createLogger();
    const adapter = createAdapter({
      updatePromptStatus: vi.fn().mockResolvedValue(undefined),
      startStreaming: vi.fn().mockImplementation((options) => {
        onSettled = options.onSettled;
        return Promise.resolve();
      }),
    });
    const processor = new PendingPromptQueueProcessor({ adapter, logger });
    processor.setEnvironment({ isOnline: true, isStreaming: false });

    await processor.processPendingPrompts();
    (adapter.updatePromptStatus as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('finalize failed')
    );
    onSettled?.('error');
    await Promise.resolve();

    expect(logger.error).toHaveBeenCalledWith(
      '[PendingPromptQueueProcessor] Failed to finalize queued prompt after streaming',
      expect.objectContaining({ promptId: 1 })
    );
  });

  it('returns prompts to queued when streaming is aborted', async () => {
    let onSettled: ((reason: 'abort') => void) | undefined;
    const adapter = createAdapter({
      startStreaming: vi.fn().mockImplementation((options) => {
        onSettled = options.onSettled;
        return Promise.resolve();
      }),
    });
    const processor = new PendingPromptQueueProcessor({ adapter, logger: createLogger() });
    processor.setEnvironment({ isOnline: true, isStreaming: false });

    await processor.processPendingPrompts();
    onSettled?.('abort');
    await Promise.resolve();

    expect(adapter.updatePromptStatus).toHaveBeenCalledWith(1, 'queued');
    expect(adapter.removePrompt).not.toHaveBeenCalled();
    expect(adapter.invalidatePendingPrompts).toHaveBeenCalled();
  });

  it('retries empty task responses and fails after the final attempt', async () => {
    const logger = createLogger();
    const adapter = createAdapter({
      runTask: vi.fn().mockResolvedValue({ task_id: '' }),
    });
    const processor = new PendingPromptQueueProcessor({
      adapter,
      logger,
      retryDelaysMs: [1],
    });
    processor.setEnvironment({ isOnline: true, isStreaming: false });

    await processor.processPendingPrompts();

    expect(adapter.runTask).toHaveBeenCalledTimes(2);
    expect(adapter.updatePromptStatus).toHaveBeenCalledWith(1, 'queued');
    expect(adapter.updatePromptStatus).toHaveBeenCalledWith(1, 'failed');
    expect(logger.warn).toHaveBeenCalledWith(
      '[PendingPromptQueueProcessor] Retrying queued prompt after empty task response',
      expect.objectContaining({ promptId: 1, attempt: 1 })
    );
    expect(adapter.startStreaming).not.toHaveBeenCalled();
  });

  it('retries retryable errors using server-provided delay before streaming', async () => {
    const logger = createLogger();
    const adapter = createAdapter({
      runTask: vi
        .fn()
        .mockRejectedValueOnce(new ApiClientError(429, { retry_after: 0.001 }, 'rate limited'))
        .mockResolvedValueOnce({ task_id: 'task-after-retry' }),
    });
    const processor = new PendingPromptQueueProcessor({
      adapter,
      logger,
      retryDelaysMs: [1000],
    });
    processor.setEnvironment({ isOnline: true, isStreaming: false });

    await processor.processPendingPrompts();

    expect(adapter.runTask).toHaveBeenCalledTimes(2);
    expect(adapter.updatePromptStatus).toHaveBeenCalledWith(1, 'queued');
    expect(adapter.updatePromptStatus).toHaveBeenCalledWith(1, 'pending');
    expect(logger.warn).toHaveBeenCalledWith(
      '[PendingPromptQueueProcessor] Retrying queued prompt after error',
      expect.objectContaining({ promptId: 1, attempt: 1, delayMs: 1 })
    );
    expect(adapter.startStreaming).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-after-retry' })
    );
  });

  it('marks non-retryable errors as failed without retrying', async () => {
    const logger = createLogger();
    const error = new ApiClientError(400, {}, 'bad prompt');
    const adapter = createAdapter({
      runTask: vi.fn().mockRejectedValue(error),
    });
    const processor = new PendingPromptQueueProcessor({
      adapter,
      logger,
      retryDelaysMs: [5],
    });
    processor.setEnvironment({ isOnline: true, isStreaming: false });

    await processor.processPendingPrompts();

    expect(adapter.runTask).toHaveBeenCalledTimes(1);
    expect(adapter.updatePromptStatus).toHaveBeenCalledWith(1, 'failed');
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      '[PendingPromptQueueProcessor] Failed to process queued prompt',
      expect.objectContaining({ error, promptId: 1 })
    );
  });
});
