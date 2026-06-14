import { describe, expect, it, vi } from 'bun:test';

import {
  createStreamingPair,
  finalizeStreamingPair,
  persistStreamingError,
} from './lifecycle-effects';

describe('shared-ts/streaming/lifecycle-effects', () => {
  it('creates a message pair and marks it ready when active', async () => {
    const insertLocalPlaceholders = vi.fn();
    const persistPlaceholderPair = vi.fn().mockResolvedValue(undefined);
    const onReady = vi.fn();

    const ids = await createStreamingPair({
      scope: {
        isActive: () => true,
        resolveConversationId: async () => 'conversation-1',
      },
      createIds: () => ({
        statusMessageId: 'status-1',
        contentMessageId: 'content-1',
      }),
      insertLocalPlaceholders,
      persistPlaceholderPair,
      onReady,
    });

    expect(ids).toEqual({
      statusMessageId: 'status-1',
      contentMessageId: 'content-1',
    });
    expect(insertLocalPlaceholders).toHaveBeenCalledWith(ids);
    expect(persistPlaceholderPair).toHaveBeenCalledWith('conversation-1', ids);
    expect(onReady).toHaveBeenCalledWith(ids);
  });

  it('rolls back placeholders when the scope becomes inactive after persistence', async () => {
    let active = true;
    const rollbackLocalPlaceholders = vi.fn().mockImplementation(async () => {
      active = false;
    });

    const ids = await createStreamingPair({
      scope: {
        isActive: () => active,
        resolveConversationId: async () => 'conversation-1',
      },
      createIds: () => ({
        statusMessageId: 'status-1',
        contentMessageId: 'content-1',
      }),
      insertLocalPlaceholders: vi.fn(),
      persistPlaceholderPair: vi.fn().mockImplementation(async () => {
        active = false;
      }),
      rollbackLocalPlaceholders,
      onReady: vi.fn(),
    });

    expect(ids).toBeNull();
    expect(rollbackLocalPlaceholders).toHaveBeenCalledWith(
      {
        statusMessageId: 'status-1',
        contentMessageId: 'content-1',
      },
      'conversation-1'
    );
  });

  it('rolls back placeholders when no conversation is available', async () => {
    const rollbackLocalPlaceholders = vi.fn();
    const persistPlaceholderPair = vi.fn();
    const onReady = vi.fn();

    const ids = await createStreamingPair({
      scope: {
        isActive: () => true,
        resolveConversationId: async () => null,
      },
      createIds: () => ({
        statusMessageId: 'status-1',
        contentMessageId: 'content-1',
      }),
      insertLocalPlaceholders: vi.fn(),
      persistPlaceholderPair,
      rollbackLocalPlaceholders,
      onReady,
    });

    expect(ids).toBeNull();
    expect(rollbackLocalPlaceholders).toHaveBeenCalledWith(
      {
        statusMessageId: 'status-1',
        contentMessageId: 'content-1',
      },
      null
    );
    expect(persistPlaceholderPair).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
  });

  it('rolls back placeholders and rethrows when placeholder persistence fails', async () => {
    const failure = new Error('write failed');
    const rollbackLocalPlaceholders = vi.fn();

    await expect(
      createStreamingPair({
        scope: {
          isActive: () => true,
          resolveConversationId: async () => 'conversation-1',
        },
        createIds: () => ({
          statusMessageId: 'status-1',
          contentMessageId: 'content-1',
        }),
        insertLocalPlaceholders: vi.fn(),
        persistPlaceholderPair: async () => {
          throw failure;
        },
        rollbackLocalPlaceholders,
        onReady: vi.fn(),
      })
    ).rejects.toThrow(failure);

    expect(rollbackLocalPlaceholders).toHaveBeenCalledWith(
      {
        statusMessageId: 'status-1',
        contentMessageId: 'content-1',
      },
      'conversation-1'
    );
  });

  it('finalizes a message pair when the scope stays active', async () => {
    const applyLocalFinalState = vi.fn();
    const persistFinalState = vi.fn().mockResolvedValue(undefined);
    const onDone = vi.fn();

    const result = await finalizeStreamingPair({
      scope: {
        isActive: () => true,
        resolveConversationId: async () => 'conversation-1',
      },
      ids: {
        statusMessageId: 'status-1',
        contentMessageId: 'content-1',
      },
      payload: { finalResponse: 'Done' },
      applyLocalFinalState,
      persistFinalState,
      onDone,
    });

    expect(result).toBe(true);
    expect(applyLocalFinalState).toHaveBeenCalled();
    expect(persistFinalState).toHaveBeenCalledWith(
      'conversation-1',
      {
        statusMessageId: 'status-1',
        contentMessageId: 'content-1',
      },
      { finalResponse: 'Done' }
    );
    expect(onDone).toHaveBeenCalled();
  });

  it('does not persist final state when the scope is inactive or missing a conversation', async () => {
    const applyLocalFinalState = vi.fn();
    const persistFinalState = vi.fn();
    const onDone = vi.fn();

    const result = await finalizeStreamingPair({
      scope: {
        isActive: () => false,
        resolveConversationId: async () => 'conversation-1',
      },
      ids: {
        statusMessageId: 'status-1',
        contentMessageId: 'content-1',
      },
      payload: { finalResponse: 'Done' },
      applyLocalFinalState,
      persistFinalState,
      onDone,
    });

    expect(result).toBe(false);
    expect(applyLocalFinalState).not.toHaveBeenCalled();
    expect(persistFinalState).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('stops finalization before persistence if local final state deactivates the scope', async () => {
    let active = true;
    const persistFinalState = vi.fn();
    const onDone = vi.fn();

    const result = await finalizeStreamingPair({
      scope: {
        isActive: () => active,
        resolveConversationId: async () => 'conversation-1',
      },
      ids: {
        statusMessageId: 'status-1',
        contentMessageId: 'content-1',
      },
      payload: { finalResponse: 'Done' },
      applyLocalFinalState: () => {
        active = false;
      },
      persistFinalState,
      onDone,
    });

    expect(result).toBe(false);
    expect(persistFinalState).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('stops finalization after persistence if the scope becomes inactive', async () => {
    let active = true;
    const onDone = vi.fn();

    const result = await finalizeStreamingPair({
      scope: {
        isActive: () => active,
        resolveConversationId: async () => 'conversation-1',
      },
      ids: {
        statusMessageId: 'status-1',
        contentMessageId: 'content-1',
      },
      payload: { finalResponse: 'Done' },
      applyLocalFinalState: vi.fn(),
      persistFinalState: async () => {
        active = false;
      },
      onDone,
    });

    expect(result).toBe(false);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('persists terminal errors and runs completion callback', async () => {
    const applyLocalError = vi.fn();
    const persistErrorState = vi.fn().mockResolvedValue(undefined);
    const onDone = vi.fn();

    const result = await persistStreamingError({
      scope: {
        isActive: () => true,
        resolveConversationId: async () => 'conversation-1',
      },
      contentMessageId: 'content-1',
      message: 'Network failure',
      applyLocalError,
      persistErrorState,
      onDone,
    });

    expect(result).toBe(true);
    expect(applyLocalError).toHaveBeenCalledWith('content-1', 'Network failure');
    expect(persistErrorState).toHaveBeenCalledWith(
      'conversation-1',
      'content-1',
      'Network failure'
    );
    expect(onDone).toHaveBeenCalled();
  });

  it('does not persist streaming errors when local error state deactivates the scope', async () => {
    let active = true;
    const persistErrorState = vi.fn();
    const onDone = vi.fn();

    const result = await persistStreamingError({
      scope: {
        isActive: () => active,
        resolveConversationId: async () => 'conversation-1',
      },
      contentMessageId: 'content-1',
      message: 'Network failure',
      applyLocalError: () => {
        active = false;
      },
      persistErrorState,
      onDone,
    });

    expect(result).toBe(false);
    expect(persistErrorState).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('stops error completion after persistence if the scope becomes inactive', async () => {
    let active = true;
    const onDone = vi.fn();

    const result = await persistStreamingError({
      scope: {
        isActive: () => active,
        resolveConversationId: async () => 'conversation-1',
      },
      contentMessageId: 'content-1',
      message: 'Network failure',
      applyLocalError: vi.fn(),
      persistErrorState: async () => {
        active = false;
      },
      onDone,
    });

    expect(result).toBe(false);
    expect(onDone).not.toHaveBeenCalled();
  });
});
