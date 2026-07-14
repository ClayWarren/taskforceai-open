import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, mock, vi } from 'bun:test';

import '../../../../../tests/setup/dom';

import { usePendingPrompts } from './usePendingPrompts';

// Mocks
const mockRunTask = mock();

mock.module('@taskforceai/api-client/api/tasks', () => ({
  runTask: mockRunTask,
}));

const mockConversationStore = {
  listPendingPrompts: mock(),
  updatePromptStatus: mock(),
  removePrompt: mock(),
};

mock.module('../platform/PlatformProvider', () => ({
  useConversationStore: () => mockConversationStore,
}));

describe('usePendingPrompts', () => {
  const mockStartStreaming = mock();

  beforeEach(() => {
    mockRunTask.mockClear();
    mockStartStreaming.mockClear();
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    });

    mockConversationStore.listPendingPrompts.mockClear();
    mockConversationStore.updatePromptStatus.mockClear();
    mockConversationStore.removePrompt.mockClear();

    mockConversationStore.listPendingPrompts.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does nothing if not authenticated', async () => {
    const { result } = renderHook(() =>
      usePendingPrompts({
        isStreaming: false,
        startStreaming: mockStartStreaming,
        isAuthenticated: false,
      })
    );

    await result.current.processPendingPrompts();
    expect(mockConversationStore.listPendingPrompts).not.toHaveBeenCalled();
  });

  it('does nothing if streaming', async () => {
    const { result } = renderHook(() =>
      usePendingPrompts({
        isStreaming: true,
        startStreaming: mockStartStreaming,
        isAuthenticated: true,
      })
    );

    await result.current.processPendingPrompts();
    expect(mockConversationStore.listPendingPrompts).not.toHaveBeenCalled();
  });

  it('does nothing if no pending prompts', async () => {
    mockConversationStore.listPendingPrompts.mockResolvedValue([]);
    const { result } = renderHook(() =>
      usePendingPrompts({
        isStreaming: false,
        startStreaming: mockStartStreaming,
        isAuthenticated: true,
      })
    );

    await result.current.processPendingPrompts();
    expect(mockRunTask).not.toHaveBeenCalled();
  });

  it('processes pending prompts successfully', async () => {
    mockConversationStore.listPendingPrompts.mockResolvedValue([
      { id: 1, prompt: 'Test Prompt', conversationId: 'conv-1', createdAt: 1700000000000 },
    ]);
    mockRunTask.mockResolvedValue({ ok: true, value: { task_id: 'task-1' } });

    const { result } = renderHook(() =>
      usePendingPrompts({
        isStreaming: false,
        startStreaming: mockStartStreaming,
        isAuthenticated: true,
      })
    );

    await act(async () => {
      await result.current.processPendingPrompts();
    });

    expect(mockConversationStore.updatePromptStatus).toHaveBeenCalledWith(1, 'pending');
    expect(mockRunTask).toHaveBeenCalledWith({
      prompt: 'Test Prompt',
      demo: false,
      modelId: undefined,
      options: { idempotencyKey: 'queue-1-1700000000000' },
    });
    expect(mockStartStreaming).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-1',
        conversationId: 'conv-1',
        prompt: 'Test Prompt',
      })
    );
  });

  it('replays queued prompts using modelId from runPayload', async () => {
    mockConversationStore.listPendingPrompts.mockResolvedValue([
      {
        id: 1,
        prompt: 'Test Prompt',
        conversationId: 'conv-1',
        createdAt: 1700000001000,
        runPayload: {
          modelId: 'gpt-5',
        },
      },
    ]);
    mockRunTask.mockResolvedValue({ ok: true, value: { task_id: 'task-1' } });

    const { result } = renderHook(() =>
      usePendingPrompts({
        isStreaming: false,
        startStreaming: mockStartStreaming,
        isAuthenticated: true,
      })
    );

    await act(async () => {
      await result.current.processPendingPrompts();
    });

    expect(mockRunTask).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Test Prompt',
        demo: false,
        modelId: 'gpt-5',
        options: { idempotencyKey: 'queue-1-1700000001000' },
      })
    );
  });

  it('replays queued prompts using the full stored runPayload', async () => {
    mockConversationStore.listPendingPrompts.mockResolvedValue([
      {
        id: 2,
        prompt: 'Autonomous retry',
        conversationId: 'conv-2',
        createdAt: 1700000003000,
        runPayload: {
          prompt: 'Autonomous retry',
          demo: false,
          modelId: 'gpt-5',
          projectId: 11,
          role_models: { Researcher: 'gpt-5-research' },
          budget: 12,
          attachment_ids: ['att-1'],
          options: {
            agentCount: 3,
            autonomyEnabled: true,
            computerUseEnabled: true,
            quickModeEnabled: false,
            useLoggedInServices: true,
          },
        },
      },
    ]);
    mockRunTask.mockResolvedValue({ ok: true, value: { task_id: 'task-2' } });

    const { result } = renderHook(() =>
      usePendingPrompts({
        isStreaming: false,
        startStreaming: mockStartStreaming,
        isAuthenticated: true,
      })
    );

    await act(async () => {
      await result.current.processPendingPrompts();
    });

    expect(mockRunTask).toHaveBeenCalledWith({
      prompt: 'Autonomous retry',
      demo: false,
      modelId: 'gpt-5',
      projectId: 11,
      role_models: { Researcher: 'gpt-5-research' },
      budget: 12,
      attachment_ids: ['att-1'],
      options: {
        agentCount: 3,
        autonomyEnabled: true,
        computerUseEnabled: true,
        quickModeEnabled: false,
        useLoggedInServices: true,
        idempotencyKey: 'queue-2-1700000003000',
      },
    });
  });

  it('handles processing errors', async () => {
    mockConversationStore.listPendingPrompts.mockResolvedValue([
      { id: 1, prompt: 'Test Prompt', conversationId: 'conv-1', createdAt: 1700000002000 },
    ]);
    mockRunTask.mockResolvedValue({
      ok: false,
      error: { message: 'Permanent Failure', status: 400 },
    });

    const { result } = renderHook(() =>
      usePendingPrompts({
        isStreaming: false,
        startStreaming: mockStartStreaming,
        isAuthenticated: true,
      })
    );

    await act(async () => {
      await result.current.processPendingPrompts();
    });

    expect(mockConversationStore.updatePromptStatus).toHaveBeenCalledWith(1, 'pending');
    expect(mockConversationStore.updatePromptStatus).toHaveBeenCalledWith(1, 'failed');
    expect(mockConversationStore.removePrompt).not.toHaveBeenCalled();
  });

  it('triggers processing when coming online', async () => {
    renderHook(() =>
      usePendingPrompts({
        isStreaming: false,
        startStreaming: mockStartStreaming,
        isAuthenticated: true,
      })
    );

    window.dispatchEvent(new Event('online'));

    await new Promise((r) => setTimeout(r, 0));
    expect(mockConversationStore.listPendingPrompts).toHaveBeenCalled();
  });
});
