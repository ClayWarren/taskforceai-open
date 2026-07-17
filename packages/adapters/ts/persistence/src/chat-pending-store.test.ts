import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { runRequestSchema } from '@taskforceai/contracts/contracts';

import { createStorageMock, type StorageAdapterMock } from '#tests/fixtures/sync-storage';
import { mapPendingChangeToPrompt, PendingPromptStore } from './chat-pending-store';

describe('persistence/chat-pending-store', () => {
  let storage: StorageAdapterMock;
  let store: PendingPromptStore;

  beforeEach(() => {
    storage = createStorageMock();
    store = new PendingPromptStore(storage);
  });

  it('enqueues prompt with queued status and timestamp', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1710002000000);

    await store.enqueuePrompt('conv-1', 'Generate summary');

    expect(storage.addPendingChange).toHaveBeenCalledWith({
      type: 'prompt',
      entityId: 'conv-1',
      operation: 'create',
      data: { prompt: 'Generate summary', status: 'queued' },
      createdAt: 1710002000000,
    });
  });

  it('rejects empty pending prompts before they reach storage', async () => {
    await expect(store.enqueuePrompt('conv-1', '   ')).rejects.toThrow(
      'Pending prompt cannot be empty'
    );

    expect(storage.addPendingChange).not.toHaveBeenCalled();
  });

  it('updates and removes pending prompts through adapter', async () => {
    storage.getPendingChanges.mockResolvedValueOnce([
      {
        id: 12,
        type: 'prompt',
        entityId: 'conv-1',
        operation: 'create',
        data: {
          prompt: 'Generate summary',
          status: 'queued',
          runPayload: { prompt: 'Generate summary', demo: false },
        },
        createdAt: 10,
      },
    ]);

    await store.updatePromptStatus(12, 'pending');
    await store.removePrompt(12);

    expect(storage.updatePendingChangeData).toHaveBeenCalledWith(12, {
      prompt: 'Generate summary',
      status: 'pending',
      runPayload: { prompt: 'Generate summary', demo: false },
    });
    expect(storage.removePendingChange).toHaveBeenCalledWith(12);
  });

  it('does not write a status-only record when the pending prompt is missing', async () => {
    storage.getPendingChanges.mockResolvedValueOnce([]);

    await store.updatePromptStatus(12, 'failed');

    expect(storage.updatePendingChangeData).not.toHaveBeenCalled();
  });

  it('preserves runPayload when enqueuing prompts', async () => {
    const runPayload = runRequestSchema.parse({
      prompt: 'Generate summary',
      demo: false,
      modelId: 'openai/gpt-5.6-sol',
      attachment_ids: ['att-1'],
    });

    await store.enqueuePrompt('conv-1', 'Generate summary', runPayload);

    expect(storage.addPendingChange).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          prompt: 'Generate summary',
          status: 'queued',
          runPayload,
        },
      })
    );
  });

  it('lists only actionable prompt records', async () => {
    storage.getPendingChanges.mockResolvedValueOnce([
      {
        id: 1,
        type: 'prompt',
        entityId: 'conv-1',
        operation: 'create',
        data: {
          prompt: 'first',
          status: 'queued',
          runPayload: {
            prompt: 'first',
            demo: false,
            modelId: 'openai/gpt-5.6-sol',
          },
        },
        createdAt: 10,
      },
      {
        id: 2,
        type: 'prompt',
        entityId: 'conv-2',
        operation: 'update',
        data: { prompt: 'second', status: 'pending' },
        createdAt: 11,
      },
      {
        id: 3,
        type: 'prompt',
        entityId: 'conv-3',
        operation: 'create',
        data: { prompt: 'third', status: 'unknown', runPayload: { prompt: 42 } },
        createdAt: 12,
      },
      {
        id: 4,
        type: 'prompt',
        entityId: 'conv-4',
        operation: 'create',
        data: 'not-an-object',
        createdAt: 13,
      },
      {
        id: 6,
        type: 'prompt',
        entityId: 'conv-6',
        operation: 'create',
        data: { prompt: '   ', status: 'queued' },
        createdAt: 15,
      },
      {
        id: 5,
        type: 'message',
        entityId: 'msg-1',
        operation: 'create',
        data: { prompt: 'ignored' },
        createdAt: 14,
      },
    ]);

    const pending = await store.listPendingPrompts();

    expect(pending).toEqual([
      {
        id: 1,
        conversationId: 'conv-1',
        prompt: 'first',
        createdAt: 10,
        status: 'queued',
        runPayload: {
          prompt: 'first',
          demo: false,
          modelId: 'openai/gpt-5.6-sol',
        },
      },
      {
        id: 3,
        conversationId: 'conv-3',
        prompt: 'third',
        createdAt: 12,
        status: 'queued',
      },
    ]);
  });

  it('sorts pending prompts and preserves pending and failed statuses', async () => {
    storage.getPendingChanges.mockResolvedValueOnce([
      {
        type: 'prompt',
        entityId: 'conv-late',
        operation: 'create',
        data: { prompt: 'late', status: 'failed' },
        createdAt: 30,
      },
      {
        id: 2,
        type: 'prompt',
        entityId: 'conv-early',
        operation: 'create',
        data: { prompt: 'early', status: 'pending' },
        createdAt: 10,
      },
    ]);

    await expect(store.listPendingPrompts()).resolves.toEqual([
      {
        id: 2,
        conversationId: 'conv-early',
        prompt: 'early',
        createdAt: 10,
        status: 'pending',
      },
      {
        conversationId: 'conv-late',
        prompt: 'late',
        createdAt: 30,
        status: 'failed',
      },
    ]);
  });

  it('sorts pending prompts without Array.prototype.toSorted', async () => {
    storage.getPendingChanges.mockResolvedValueOnce([
      {
        id: 1,
        type: 'prompt',
        entityId: 'conv-late',
        operation: 'create',
        data: { prompt: 'late', status: 'queued' },
        createdAt: 30,
      },
      {
        id: 2,
        type: 'prompt',
        entityId: 'conv-early',
        operation: 'create',
        data: { prompt: 'early', status: 'queued' },
        createdAt: 10,
      },
    ]);

    const arrayPrototype = Array.prototype as unknown as {
      toSorted?: (...args: unknown[]) => unknown;
    };
    const originalToSorted = arrayPrototype.toSorted;
    Object.defineProperty(arrayPrototype, 'toSorted', {
      configurable: true,
      value: () => {
        throw new Error('toSorted unavailable');
      },
    });

    let pending: Awaited<ReturnType<PendingPromptStore['listPendingPrompts']>>;
    try {
      pending = await store.listPendingPrompts();
    } finally {
      if (originalToSorted) {
        Object.defineProperty(arrayPrototype, 'toSorted', {
          configurable: true,
          value: originalToSorted,
        });
      } else {
        delete arrayPrototype.toSorted;
      }
    }

    expect(pending).toEqual([
      {
        id: 2,
        conversationId: 'conv-early',
        prompt: 'early',
        createdAt: 10,
        status: 'queued',
      },
      {
        id: 1,
        conversationId: 'conv-late',
        prompt: 'late',
        createdAt: 30,
        status: 'queued',
      },
    ]);
  });

  it('maps individual pending changes with validated runPayload', () => {
    expect(
      mapPendingChangeToPrompt({
        id: 9,
        type: 'prompt',
        entityId: 'conv-9',
        operation: 'create',
        data: {
          prompt: 'queued prompt',
          status: 'failed',
          runPayload: {
            prompt: 'queued prompt',
            demo: false,
            modelId: 'openai/gpt-5.6-sol',
          },
        },
        createdAt: 99,
      })
    ).toEqual({
      id: 9,
      conversationId: 'conv-9',
      prompt: 'queued prompt',
      createdAt: 99,
      status: 'failed',
      runPayload: {
        prompt: 'queued prompt',
        demo: false,
        modelId: 'openai/gpt-5.6-sol',
      },
    });

    expect(
      mapPendingChangeToPrompt({
        type: 'prompt',
        entityId: 'conv-10',
        operation: 'create',
        data: { prompt: '   ' },
        createdAt: 100,
      })
    ).toBeNull();
  });
});
