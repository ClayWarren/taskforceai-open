import { afterEach, beforeEach, describe, expect, it, mock, vi } from 'bun:test';

import { createStreamingStore } from './createStreamingStore';
import type { StreamingStoreAdapter } from './createStreamingStore';
import {
  StreamingConnectionError,
  streamingConnectionMessageForCode,
  streamingFailureDisplayMessage,
} from '../streaming-errors';

const createLogger = () => ({
  debug: mock(() => {}),
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
});

const createAdapter = (disconnect = mock(() => {})) => {
  const callbacks = {
    onMessage: null as ((payload: string) => void) | null,
    onError: null as ((error: unknown) => void) | null,
    onOpen: null as (() => void) | null,
  };
  const adapter: StreamingStoreAdapter = {
    logger: createLogger(),
    connect: mock(async (_taskId, onMessage, onError, onOpen) => {
      callbacks.onMessage = onMessage;
      callbacks.onError = onError;
      callbacks.onOpen = onOpen ?? null;
      return disconnect;
    }),
  };
  return { adapter, callbacks, disconnect };
};

describe('createStreamingStore', () => {
  let adapter: StreamingStoreAdapter;
  let disconnect: ReturnType<typeof mock>;

  beforeEach(() => {
    vi.useRealTimers();
    disconnect = mock(() => {});
    adapter = {
      logger: createLogger(),
      connect: mock(async () => disconnect),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initializes and starts streams with requested options', async () => {
    const store = createStreamingStore(adapter);

    expect(store.getState().isStreaming).toBe(false);
    expect(store.getState().errorMessage).toBeNull();
    expect(store.getState().streamContent).toBe('');
    expect(store.getState().sources).toEqual([]);
    expect(store.getState().toolEvents).toEqual([]);
    expect(store.getState().finalResponse).toBeNull();
    expect(store.getState().reasoning).toBe('');

    await store.getState().startStreaming({
      taskId: 'task-1',
      conversationId: 'conv-1',
      prompt: 'hello',
      agentCount: 2,
      computerUseEnabled: true,
      useLoggedInServices: true,
      budgetLimit: 7,
    });

    expect(adapter.connect).toHaveBeenCalledWith(
      'task-1',
      expect.any(Function),
      expect.any(Function),
      expect.any(Function)
    );
    expect(store.getState().isStreaming).toBe(true);
    expect(store.getState().computerUseEnabled).toBe(true);
    expect(store.getState().useLoggedInServices).toBe(true);
    expect(store.getState().budgetLimit).toBe(7);
    expect(store.getState().agentStatuses).toHaveLength(2);

    store.getState().stopStreaming();
    expect(disconnect).toHaveBeenCalled();
    expect(store.getState().isStreaming).toBe(false);
  });

  it('defaults optional streaming capabilities to logged-out mode', async () => {
    const store = createStreamingStore(adapter);

    await store.getState().startStreaming({
      taskId: 'task-1',
      conversationId: 'conv-1',
      prompt: 'hello',
    });

    expect(store.getState().computerUseEnabled).toBe(false);
    expect(store.getState().useLoggedInServices).toBe(false);
    expect(store.getState().budgetLimit).toBeNull();

    store.getState().stopStreaming();
  });

  it('aborts an existing stream before starting a new one', async () => {
    const firstDisconnect = mock(() => {});
    const secondDisconnect = mock(() => {});
    const setup = createAdapter(firstDisconnect);
    const store = createStreamingStore(setup.adapter);

    await store.getState().startStreaming({ taskId: 'task-1', conversationId: 'c', prompt: 'p' });
    setup.callbacks.onMessage?.(JSON.stringify({ type: 'progress', chunk: 'partial content' }));
    expect(store.getState().streamContent).toBe('partial content');

    setup.adapter.connect = mock(async () => secondDisconnect);
    await store.getState().startStreaming({ taskId: 'task-2', conversationId: 'c', prompt: 'p' });

    expect(firstDisconnect).toHaveBeenCalled();
    expect(store.getState().isStreaming).toBe(true);
    expect(store.getState().streamContent).toBe('');
    store.getState().stopStreaming();
    expect(secondDisconnect).toHaveBeenCalled();
  });

  it('cancels the active backend task and closes the stream', async () => {
    const cancelTask = mock(async () => {});
    adapter.cancelTask = cancelTask;
    const store = createStreamingStore(adapter);

    await store.getState().startStreaming({ taskId: 'task-1', conversationId: 'c', prompt: 'p' });
    await store.getState().cancelStreaming();

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(cancelTask).toHaveBeenCalledWith('task-1');
    expect(store.getState().isStreaming).toBe(false);
  });

  it('logs and surfaces cancel failures after closing the stream', async () => {
    const cancelError = new Error('cancel failed');
    adapter.cancelTask = mock(async () => {
      throw cancelError;
    });
    const store = createStreamingStore(adapter);

    await store.getState().startStreaming({ taskId: 'task-1', conversationId: 'c', prompt: 'p' });
    await store.getState().cancelStreaming();

    expect(store.getState().isStreaming).toBe(false);
    expect(store.getState().errorMessage).toBe('Failed to stop run');
    expect(adapter.logger.error).toHaveBeenCalledWith(
      '[StreamingStore] Failed to cancel task',
      expect.objectContaining({ error: cancelError, taskId: 'task-1' })
    );
  });

  it('handles progress, start, approval, budget, and completion payloads', async () => {
    const onSettled = mock(() => {});
    const onConversationId = mock(() => {});
    const onApproval = mock(() => {});
    const setup = createAdapter();
    const store = createStreamingStore(setup.adapter);

    await store.getState().startStreaming({
      taskId: 'task-1',
      conversationId: 'conv-1',
      prompt: 'hello',
      onSettled,
      onConversationId,
      onApproval,
    });

    setup.callbacks.onOpen?.();
    setup.callbacks.onMessage?.(JSON.stringify({ type: 'start', model_id: 'model-1' }));
    setup.callbacks.onMessage?.(JSON.stringify({ type: 'progress', chunk: 'Hello' }));
    setup.callbacks.onMessage?.(
      JSON.stringify({ type: 'progress', reasoning: 'Step one.', budget_usage: { consumedUsd: 2 } })
    );
    setup.callbacks.onMessage?.(JSON.stringify({ type: 'progress', reasoning: ' Step two.' }));
    const approval = {
      approvalId: 'approval-1',
      permission: 'fs.read',
      agentName: 'Researcher',
      patterns: ['/workspace/**'],
      metadata: {},
    };
    setup.callbacks.onMessage?.(
      JSON.stringify({
        type: 'progress',
        pending_approval: approval,
      })
    );
    expect(store.getState().pendingApproval).toEqual(approval);
    setup.callbacks.onMessage?.(
      JSON.stringify({ type: 'complete', message: 'Done', conversation_id: 42 })
    );

    expect(store.getState().modelId).toBe('model-1');
    expect(store.getState().streamContent).toBe('Done');
    expect(store.getState().finalResponse).toBe('Done');
    expect(store.getState().reasoning).toBe('Step one. Step two.');
    expect(store.getState().currentSpend).toBe(2);
    expect(store.getState().isStreaming).toBe(false);
    expect(onApproval).toHaveBeenCalledWith(approval);
    expect(onConversationId).toHaveBeenCalledWith(42);
    expect(onSettled).toHaveBeenCalledWith('complete');
  });

  it('seeds agent status model labels when streaming starts', async () => {
    const setup = createAdapter();
    const store = createStreamingStore(setup.adapter);

    await store.getState().startStreaming({
      taskId: 'task-1',
      conversationId: 'conv-1',
      prompt: 'hello',
      agentCount: 2,
      agentLabels: ['model-a', 'model-b'],
    });

    expect(store.getState().agentStatuses).toEqual([
      { agent_id: 0, status: 'QUEUED', progress: 0.05, model: 'model-a' },
      { agent_id: 1, status: 'QUEUED', progress: 0.05, model: 'model-b' },
    ]);
  });

  it('prepares a visible stream before a task id is available', async () => {
    const setup = createAdapter();
    const store = createStreamingStore(setup.adapter);

    store.getState().prepareStreaming({
      conversationId: 'conv-1',
      prompt: 'hello',
      agentCount: 2,
      agentLabels: ['model-a', 'model-b'],
      computerUseEnabled: true,
      useLoggedInServices: true,
      budgetLimit: 10,
    });

    expect(setup.adapter.connect).not.toHaveBeenCalled();
    expect(store.getState().isStreaming).toBe(true);
    expect(store.getState().computerUseEnabled).toBe(true);
    expect(store.getState().useLoggedInServices).toBe(true);
    expect(store.getState().budgetLimit).toBe(10);
    expect(store.getState().agentStatuses).toEqual([
      { agent_id: 0, status: 'QUEUED', progress: 0.05, model: 'model-a' },
      { agent_id: 1, status: 'QUEUED', progress: 0.05, model: 'model-b' },
    ]);

    await store.getState().startStreaming({
      taskId: 'task-1',
      conversationId: 'conv-1',
      prompt: 'hello',
      agentCount: 2,
      agentLabels: ['model-a', 'model-b'],
    });

    expect(setup.adapter.connect).toHaveBeenCalledWith(
      'task-1',
      expect.any(Function),
      expect.any(Function),
      expect.any(Function)
    );
    expect(store.getState().agentStatuses).toEqual([
      { agent_id: 0, status: 'QUEUED', progress: 0.05, model: 'model-a' },
      { agent_id: 1, status: 'QUEUED', progress: 0.05, model: 'model-b' },
    ]);
  });

  it('logs debug output when preparing a stream in debug mode', () => {
    const setup = createAdapter();
    setup.adapter.debug = true;
    const store = createStreamingStore(setup.adapter);

    store.getState().prepareStreaming({
      conversationId: 'conv-1',
      prompt: 'hello',
    });

    expect(setup.adapter.logger.debug).toHaveBeenCalledWith(
      '[StreamingStore] prepareStreaming invoked'
    );
  });

  it('settles prepared streams when task creation fails', () => {
    const setup = createAdapter();
    const store = createStreamingStore(setup.adapter);

    store.getState().prepareStreaming({
      conversationId: 'conv-1',
      prompt: 'hello',
      agentCount: 1,
    });

    store.getState().failPreparedStreaming('Failed to run task');

    expect(store.getState().isStreaming).toBe(false);
    expect(store.getState().errorMessage).toBe('Failed to run task');
  });

  it('keeps launch model labels through backend progress and completion snapshots', async () => {
    const setup = createAdapter();
    const store = createStreamingStore(setup.adapter);

    await store.getState().startStreaming({
      taskId: 'task-1',
      conversationId: 'conv-1',
      prompt: 'hello',
      agentCount: 2,
      agentLabels: ['model-a', 'model-b'],
    });

    setup.callbacks.onMessage?.(
      JSON.stringify({
        type: 'progress',
        agent_statuses: [
          { agent_id: 0, status: 'PROCESSING...', progress: 0.4, model: 'Sentinel' },
          { agent_id: 1, status: 'PROCESSING...', progress: 0.3, model: 'Sentinel' },
        ],
      })
    );

    expect(store.getState().agentStatuses).toEqual([
      { agent_id: 0, status: 'PROCESSING...', progress: 0.4, model: 'model-a' },
      { agent_id: 1, status: 'PROCESSING...', progress: 0.3, model: 'model-b' },
    ]);

    setup.callbacks.onMessage?.(
      JSON.stringify({
        type: 'complete',
        message: 'Done',
        agent_statuses: [
          { agent_id: 0, status: 'COMPLETED', progress: 1, model: 'Sentinel' },
          { agent_id: 1, status: 'COMPLETED', progress: 1, model: 'Sentinel' },
        ],
      })
    );

    expect(store.getState().agentStatuses).toEqual([
      { agent_id: 0, status: 'COMPLETED', progress: 1, model: 'model-a' },
      { agent_id: 1, status: 'COMPLETED', progress: 1, model: 'model-b' },
    ]);
    expect(store.getState().finalResponse).toBe('Done');
  });

  it('surfaces tool events from live progress payloads before completion', async () => {
    const onSettled = mock(() => {});
    const setup = createAdapter();
    const store = createStreamingStore(setup.adapter);

    await store.getState().startStreaming({
      taskId: 'task-1',
      conversationId: 'conv-1',
      prompt: 'latest news',
      agentCount: 1,
      agentLabels: ['model-a'],
      onSettled,
    });

    setup.callbacks.onMessage?.(
      JSON.stringify({
        type: 'progress',
        chunk: 'Draft answer',
        reasoning: 'Found a useful source.',
        tool_events: [
          {
            agent_id: 0,
            tool_name: 'search_web',
            status: 'complete',
            arguments: { query: 'latest news' },
            duration_ms: 250,
            tool_output: 'Found source',
            sources: [{ url: 'https://example.com/news', title: 'News' }],
          },
        ],
      })
    );

    expect(store.getState().toolEvents).toEqual([
      expect.objectContaining({
        agentId: 0,
        agentLabel: 'Agent 1',
        toolName: 'search_web',
        arguments: { query: 'latest news' },
        success: true,
        durationMs: 250,
        resultPreview: 'Found source',
      }),
    ]);
    expect(store.getState().sources).toEqual([{ url: 'https://example.com/news', title: 'News' }]);
    expect(store.getState().finalToolEvents).toEqual([]);
    expect(store.getState().streamContent).toBe('Draft answer');
    expect(store.getState().reasoning).toBe('Found a useful source.');

    store.getState().stopStreaming();

    expect(store.getState().streamContent).toBe('');
    expect(store.getState().sources).toEqual([]);
    expect(store.getState().toolEvents).toEqual([]);
    expect(store.getState().reasoning).toBe('');
    expect(store.getState().finalReasoning).toBeNull();
    expect(onSettled).toHaveBeenCalledWith('abort');
  });

  it('logs malformed payloads and ignores empty or late messages', async () => {
    const setup = createAdapter();
    const store = createStreamingStore(setup.adapter);

    await store.getState().startStreaming({ taskId: 'task-1', conversationId: 'c', prompt: 'p' });
    setup.callbacks.onMessage?.('');
    setup.callbacks.onMessage?.('not-json');
    expect(setup.adapter.logger.warn).toHaveBeenCalled();
    expect(store.getState().isStreaming).toBe(true);

    store.getState().stopStreaming();
    setup.callbacks.onMessage?.(JSON.stringify({ type: 'progress', chunk: 'late' }));
    expect(store.getState().streamContent).toBe('');
  });

  it('sets error state for stream error payloads and runtime errors', async () => {
    const onSettled = mock(() => {});
    const setup = createAdapter();
    const store = createStreamingStore(setup.adapter);

    await store
      .getState()
      .startStreaming({ taskId: 'task-1', conversationId: 'c', prompt: 'p', onSettled });
    setup.callbacks.onMessage?.(JSON.stringify({ type: 'error', error: 'boom' }));

    expect(store.getState().errorMessage).toBe('boom');
    expect(store.getState().isStreaming).toBe(false);
    expect(onSettled).toHaveBeenCalledWith('error');

    await store.getState().startStreaming({ taskId: 'task-2', conversationId: 'c', prompt: 'p' });
    setup.callbacks.onError?.(new Error('dropped'));
    expect(store.getState().errorMessage).toBe('Streaming failed');
    expect(store.getState().isStreaming).toBe(false);

    await store.getState().startStreaming({ taskId: 'task-3', conversationId: 'c', prompt: 'p' });
    setup.callbacks.onError?.(new Error('Response interrupted — connection timed out'));
    expect(store.getState().errorMessage).toBe('Streaming connection timed out');
    expect(store.getState().isStreaming).toBe(false);
  });

  it('preserves an existing error message when a runtime error follows', async () => {
    const setup = createAdapter();
    const store = createStreamingStore(setup.adapter);

    await store.getState().startStreaming({ taskId: 'task-1', conversationId: 'c', prompt: 'p' });
    store.getState().setErrorMessage('Backend rejected the request');
    setup.callbacks.onError?.(new Error('socket dropped'));

    expect(store.getState().errorMessage).toBe('Backend rejected the request');
    expect(store.getState().isStreaming).toBe(false);
  });

  it('handles connection failures and timeout messages', async () => {
    adapter.connect = mock(async () => {
      throw new Error('Response interrupted — connection timed out');
    });
    const store = createStreamingStore(adapter);

    await expect(
      store.getState().startStreaming({ taskId: 'task-1', conversationId: 'c', prompt: 'p' })
    ).rejects.toThrow('Streaming connection timed out');

    expect(store.getState().errorMessage).toBe('Streaming connection timed out');

    const connectionFailure = new Error('other failure');
    adapter.connect = mock(async () => {
      throw connectionFailure;
    });
    let thrownError: unknown;
    try {
      await store.getState().startStreaming({ taskId: 'task-2', conversationId: 'c', prompt: 'p' });
    } catch (error) {
      thrownError = error;
    }
    expect(thrownError).toBeInstanceOf(StreamingConnectionError);
    expect((thrownError as StreamingConnectionError).code).toBe('connection_failed');
    expect((thrownError as StreamingConnectionError).cause).toBe(connectionFailure);
    expect(store.getState().errorMessage).toBe('Streaming failed');
  });

  it('throws a typed connection error when startup failure is reported before rejection', async () => {
    const startupError = new Error('Streaming HTTP 503');
    adapter.connect = mock(async (_taskId, _onMessage, onError) => {
      onError(startupError);
      throw new Error('Streaming connection failed');
    });
    const store = createStreamingStore(adapter);

    let thrownError: unknown;
    try {
      await store.getState().startStreaming({ taskId: 'task-1', conversationId: 'c', prompt: 'p' });
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(StreamingConnectionError);
    expect((thrownError as StreamingConnectionError).code).toBe('connection_failed');
    expect((thrownError as StreamingConnectionError).cause).toBe(startupError);
    expect(store.getState().errorMessage).toBe('Streaming failed');
  });

  it('ignores stale connection failures after the stream has been stopped', async () => {
    let rejectConnect: ((error: Error) => void) | undefined;
    adapter.connect = mock(
      () =>
        new Promise<() => void>((_resolve, reject) => {
          rejectConnect = reject;
        })
    );
    const store = createStreamingStore(adapter);

    const startPromise = store
      .getState()
      .startStreaming({ taskId: 'task-1', conversationId: 'c', prompt: 'p' });
    store.getState().stopStreaming();
    rejectConnect?.(new Error('late connect failure'));
    await startPromise;

    expect(adapter.logger.error).not.toHaveBeenCalledWith(
      'Streaming connection failed',
      expect.anything()
    );
    expect(store.getState().errorMessage).toBeNull();
  });

  it('disconnects delayed stale connections and logs callback failures', async () => {
    const delayedDisconnect = mock(() => {});
    let resolveConnect: (() => void) | undefined;
    const callbacks = {
      onMessage: null as ((payload: string) => void) | null,
      onError: null as ((error: unknown) => void) | null,
      onOpen: null as (() => void) | null,
    };
    adapter.connect = mock(async (_taskId, onMessage, onError, onOpen) => {
      callbacks.onMessage = onMessage;
      callbacks.onError = onError;
      callbacks.onOpen = onOpen ?? null;
      await new Promise<void>((resolve) => {
        resolveConnect = resolve;
      });
      return delayedDisconnect;
    });
    const store = createStreamingStore(adapter);
    const startPromise = store
      .getState()
      .startStreaming({ taskId: 'task-1', conversationId: 'c', prompt: 'p' });

    store.getState().stopStreaming();
    resolveConnect?.();
    await startPromise;
    callbacks.onMessage?.(JSON.stringify({ type: 'progress', chunk: 'late' }));

    expect(delayedDisconnect).toHaveBeenCalled();
    expect(store.getState().streamContent).toBe('');

    const loggedErrorsBeforeStaleCallbacks = (adapter.logger.error as ReturnType<typeof mock>).mock
      .calls.length;
    callbacks.onError?.(new Error('late runtime error'));
    callbacks.onOpen?.();
    expect(store.getState().errorMessage).toBeNull();
    expect(adapter.logger.error).toHaveBeenCalledTimes(loggedErrorsBeforeStaleCallbacks);

    adapter.connect = mock(async () => mock(() => {}));
    const onSettled = mock(() => {
      throw new Error('settled failure');
    });
    await store
      .getState()
      .startStreaming({ taskId: 'task-2', conversationId: 'c', prompt: 'p', onSettled });
    store.getState().stopStreaming();
    expect(adapter.logger.error).toHaveBeenCalled();
  });

  it('logs disconnect failures and async settlement failures', async () => {
    const disconnectError = new Error('disconnect failed');
    const secondDisconnect = mock(() => {});
    let connectCount = 0;
    const adapterWithThrowingDisconnect: StreamingStoreAdapter = {
      debug: true,
      logger: createLogger(),
      connect: mock(async (_taskId, _onMessage, _onError, onOpen) => {
        onOpen?.();
        connectCount += 1;
        return connectCount === 1
          ? () => {
              throw disconnectError;
            }
          : secondDisconnect;
      }),
    };
    const store = createStreamingStore(adapterWithThrowingDisconnect);
    const onSettled = mock(async () => {
      throw new Error('async settle failed');
    });

    await store
      .getState()
      .startStreaming({ taskId: 'task-1', conversationId: 'c', prompt: 'p', onSettled });
    store.getState().stopStreaming();
    await Promise.resolve();

    await store.getState().startStreaming({ taskId: 'task-2', conversationId: 'c', prompt: 'p' });
    store.getState().stopStreaming();
    await Promise.resolve();

    expect(adapterWithThrowingDisconnect.logger.debug).toHaveBeenCalled();
    expect(secondDisconnect).toHaveBeenCalledTimes(1);
    expect(adapterWithThrowingDisconnect.logger.error).toHaveBeenCalledWith(
      '[StreamingStore] Failed to disconnect stream',
      expect.objectContaining({ error: disconnectError, reason: 'abort' })
    );
    expect(adapterWithThrowingDisconnect.logger.error).toHaveBeenCalledWith(
      'Error in async onSettled callback',
      expect.objectContaining({ reason: 'abort' })
    );
  });

  it('updates elapsed seconds while a stream is active', async () => {
    vi.useFakeTimers();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const store = createStreamingStore(adapter);

    await store.getState().startStreaming({ taskId: 'task-1', conversationId: 'c', prompt: 'p' });
    nowSpy.mockReturnValue(3_500);
    vi.advanceTimersByTime(1_000);

    expect(store.getState().elapsedSeconds).toBe(2);
    store.getState().stopStreaming();
  });

  it('clears and resets state through public actions', () => {
    const store = createStreamingStore(adapter);

    store.getState().setErrorMessage('limited', '2030-01-01');
    expect(store.getState().errorMessage).toBe('limited');
    expect(store.getState().rateLimitResetTime).toBe('2030-01-01');

    store.getState().clearErrorMessage();
    expect(store.getState().errorMessage).toBeNull();
    expect(store.getState().rateLimitResetTime).toBeNull();

    store.getState().setErrorMessage('again');
    store.getState().reset();
    expect(store.getState().errorMessage).toBeNull();
    expect(store.getState().streamContent).toBe('');
    expect(store.getState().finalResponse).toBeNull();
  });

  it('treats cancel without an active cancellable task as a no-op', async () => {
    const cancelTask = mock(async () => {});
    adapter.cancelTask = cancelTask;
    const store = createStreamingStore(adapter);

    await store.getState().cancelStreaming();

    expect(cancelTask).not.toHaveBeenCalled();
    expect(store.getState().isStreaming).toBe(false);
  });
});

describe('streaming error helpers', () => {
  it('maps timeout and failed connection messages', () => {
    const timeout = new StreamingConnectionError({ code: 'connection_timeout' });

    expect(timeout.name).toBe('StreamingConnectionError');
    expect(timeout.message).toBe('Streaming connection timed out');
    expect(streamingConnectionMessageForCode('connection_timeout')).toBe(
      'Streaming connection timed out'
    );
    expect(streamingConnectionMessageForCode('connection_failed')).toBe(
      'Streaming connection failed'
    );
    expect(streamingFailureDisplayMessage(timeout)).toBe('Streaming connection timed out');
    expect(streamingFailureDisplayMessage(new Error('boom'))).toBe('Streaming failed');
  });
});
