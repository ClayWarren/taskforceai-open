import { beforeEach, describe, expect, it, vi } from 'bun:test';

import {
  createPendingPromptQueueAdapter,
  createResultPendingPromptQueueStorage,
} from './pendingPromptQueueAdapter';

describe('pendingPromptQueueAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards storage methods and normalizes queued run metadata into a RunRequest', async () => {
    const listPendingPrompts = vi.fn(async () => [
      { id: 1, conversationId: 'conv-1', prompt: 'hello', createdAt: 1, status: 'queued' as const },
    ]);
    const updatePromptStatus = vi.fn(async () => undefined);
    const removePrompt = vi.fn(async () => undefined);
    const runTask = vi.fn(async () => ({ task_id: 'task-1' }));
    const startStreaming = vi.fn(async () => undefined);
    const invalidatePendingPrompts = vi.fn();

    const adapter = createPendingPromptQueueAdapter({
      storage: {
        listPendingPrompts,
        updatePromptStatus,
        removePrompt,
      },
      runTask,
      startStreaming,
      invalidatePendingPrompts,
    });

    await expect(adapter.listPendingPrompts()).resolves.toEqual([
      { id: 1, conversationId: 'conv-1', prompt: 'hello', createdAt: 1, status: 'queued' },
    ]);
    await adapter.updatePromptStatus(1, 'failed');
    await adapter.removePrompt(1);
    await expect(
      adapter.runTask('hello', {
        idempotencyKey: 'idem-1',
        modelId: 'model-1',
        attachmentIds: ['file-1'],
      })
    ).resolves.toEqual({ task_id: 'task-1' });
    await adapter.startStreaming({
      taskId: 'task-1',
      conversationId: 'conv-1',
      prompt: 'hello',
    });
    adapter.invalidatePendingPrompts?.();

    expect(updatePromptStatus).toHaveBeenCalledWith(1, 'failed');
    expect(removePrompt).toHaveBeenCalledWith(1);
    expect(runTask).toHaveBeenCalledWith({
      prompt: 'hello',
      demo: false,
      modelId: 'model-1',
      attachment_ids: ['file-1'],
      options: { idempotencyKey: 'idem-1' },
    });
    expect(startStreaming).toHaveBeenCalledWith({
      taskId: 'task-1',
      conversationId: 'conv-1',
      prompt: 'hello',
    });
    expect(invalidatePendingPrompts).toHaveBeenCalled();
  });

  it('omits optional model and attachment metadata when absent', async () => {
    const runTask = vi.fn(async () => ({ task_id: 'task-1' }));

    const adapter = createPendingPromptQueueAdapter({
      storage: {
        listPendingPrompts: vi.fn(async () => []),
        updatePromptStatus: vi.fn(async () => undefined),
        removePrompt: vi.fn(async () => undefined),
      },
      runTask,
      startStreaming: vi.fn(async () => undefined),
    });

    await adapter.runTask('hello', { idempotencyKey: 'idem-1' });

    expect(runTask).toHaveBeenCalledWith({
      prompt: 'hello',
      demo: false,
      options: { idempotencyKey: 'idem-1' },
    });
  });

  it('replays the full stored run payload with an idempotency key', async () => {
    const runTask = vi.fn(async () => ({ task_id: 'task-1' }));

    const adapter = createPendingPromptQueueAdapter({
      storage: {
        listPendingPrompts: vi.fn(async () => []),
        updatePromptStatus: vi.fn(async () => undefined),
        removePrompt: vi.fn(async () => undefined),
      },
      runTask,
      startStreaming: vi.fn(async () => undefined),
    });

    await adapter.runTask('replay this', {
      idempotencyKey: 'idem-1',
      runPayload: {
        prompt: 'original prompt',
        demo: false,
        modelId: 'model-1',
        projectId: 17,
        role_models: { Researcher: 'model-research' },
        budget: 25,
        attachment_ids: ['file-1'],
        options: {
          agentCount: 3,
          autonomyEnabled: true,
          computerUseEnabled: true,
          quickModeEnabled: false,
          useLoggedInServices: true,
        },
      },
    });

    expect(runTask).toHaveBeenCalledWith({
      prompt: 'replay this',
      demo: false,
      modelId: 'model-1',
      projectId: 17,
      role_models: { Researcher: 'model-research' },
      budget: 25,
      attachment_ids: ['file-1'],
      options: {
        agentCount: 3,
        autonomyEnabled: true,
        computerUseEnabled: true,
        quickModeEnabled: false,
        useLoggedInServices: true,
        idempotencyKey: 'idem-1',
      },
    });
  });

  it('rejects queued MCP client tool replay because approvals cannot be handled', async () => {
    const runTask = vi.fn(async () => ({ task_id: 'task-1' }));

    const adapter = createPendingPromptQueueAdapter({
      storage: {
        listPendingPrompts: vi.fn(async () => []),
        updatePromptStatus: vi.fn(async () => undefined),
        removePrompt: vi.fn(async () => undefined),
      },
      runTask,
      startStreaming: vi.fn(async () => undefined),
    });

    await expect(
      adapter.runTask('replay this', {
        idempotencyKey: 'idem-1',
        runPayload: {
          prompt: 'original prompt',
          demo: false,
          options: {
            clientTools: [{ serverName: 'linear', toolName: 'create_issue' }],
          },
        },
      })
    ).rejects.toMatchObject({
      message: 'Queued prompts with MCP client tools require an approval handler',
      status: 400,
    });
    expect(runTask).not.toHaveBeenCalled();
  });

  it('ignores empty attachment arrays when building run requests', async () => {
    const runTask = vi.fn(async () => ({ task_id: 'task-1' }));

    const adapter = createPendingPromptQueueAdapter({
      storage: {
        listPendingPrompts: vi.fn(async () => []),
        updatePromptStatus: vi.fn(async () => undefined),
        removePrompt: vi.fn(async () => undefined),
      },
      runTask,
      startStreaming: vi.fn(async () => undefined),
    });

    await adapter.runTask('hello', {
      idempotencyKey: 'idem-1',
      modelId: 'model-1',
      attachmentIds: [],
    });

    expect(runTask).toHaveBeenCalledWith({
      prompt: 'hello',
      demo: false,
      modelId: 'model-1',
      options: { idempotencyKey: 'idem-1' },
    });
  });

  it('adapts result-returning pending prompt storage with safe fallback logging', async () => {
    const logger = { error: vi.fn() };
    const updatePromptStatus = vi.fn(async () => undefined);
    const removePrompt = vi.fn(async () => undefined);
    const prompt = {
      id: 1,
      conversationId: 'conv-1',
      prompt: 'hello',
      createdAt: 1,
      status: 'queued' as const,
    };

    const successStorage = createResultPendingPromptQueueStorage({
      listPendingPrompts: vi.fn(async () => ({ ok: true as const, value: [prompt] })),
      updatePromptStatus,
      removePrompt,
      logger,
    });

    await expect(successStorage.listPendingPrompts()).resolves.toEqual([prompt]);
    await successStorage.updatePromptStatus(1, 'pending');
    await successStorage.removePrompt(1);
    expect(updatePromptStatus).toHaveBeenCalledWith(1, 'pending');
    expect(removePrompt).toHaveBeenCalledWith(1);
    expect(logger.error).not.toHaveBeenCalled();

    const error = new Error('storage failed');
    const failureStorage = createResultPendingPromptQueueStorage({
      listPendingPrompts: vi.fn(async () => ({ ok: false as const, error })),
      updatePromptStatus,
      removePrompt,
      logger,
    });

    await expect(failureStorage.listPendingPrompts()).resolves.toEqual([]);
    expect(logger.error).toHaveBeenCalledWith('Failed to fetch pending prompts', { error });
  });
});
