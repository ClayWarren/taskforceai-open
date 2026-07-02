import { describe, expect, it, mock, beforeEach } from 'bun:test';
import { createStreamingStore } from './createStreamingStore';
import type { StreamingStoreAdapter } from './createStreamingStore';

// Helper that captures the callbacks passed to adapter.connect so tests can simulate SSE events
function makeAdapter(disconnectMock: ReturnType<typeof mock>) {
  const callbacks = {
    onMessage: null as ((payload: string) => void) | null,
    onError: null as ((error: any) => void) | null,
    onOpen: null as (() => void) | null,
  };

  const adapter: StreamingStoreAdapter = {
    logger: {
      debug: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
      error: mock(() => {}),
    },
    connect: mock(async (_taskId, onMessage, onError, onOpen) => {
      callbacks.onMessage = onMessage;
      callbacks.onError = onError;
      callbacks.onOpen = onOpen ?? null;
      return disconnectMock;
    }),
  };

  return { adapter, callbacks };
}

describe('createStreamingStore', () => {
  let disconnectMock: ReturnType<typeof mock>;
  let mockAdapter: StreamingStoreAdapter;

  beforeEach(() => {
    disconnectMock = mock(() => {});
    mockAdapter = {
      logger: {
        debug: mock(() => {}),
        info: mock(() => {}),
        warn: mock(() => {}),
        error: mock(() => {}),
      },
      connect: mock(async () => disconnectMock),
    };
  });

  describe('initialization', () => {
    it('should initialize with default state', () => {
      const useStore = createStreamingStore(mockAdapter);
      const state = useStore.getState();
      expect(state.isStreaming).toBe(false);
      expect(state.errorMessage).toBeNull();
      expect(state.streamContent).toBe('');
      expect(state.sources).toEqual([]);
      expect(state.toolEvents).toEqual([]);
      expect(state.finalResponse).toBeNull();
      expect(state.reasoning).toBe('');
    });
  });

  describe('startStreaming', () => {
    it('should start streaming and update state', async () => {
      const useStore = createStreamingStore(mockAdapter);

      await useStore.getState().startStreaming({
        taskId: 'test-task',
        conversationId: 'test-conv',
        prompt: 'hello',
      });

      expect(useStore.getState().isStreaming).toBe(true);
      expect(mockAdapter.connect).toHaveBeenCalled();
      expect((mockAdapter.connect as any).mock.calls[0][0]).toBe('test-task');

      useStore.getState().stopStreaming();
    });

    it('sets computer use options from startStreaming payload', async () => {
      const useStore = createStreamingStore(mockAdapter);

      await useStore.getState().startStreaming({
        taskId: 'task-1',
        conversationId: 'conv-1',
        prompt: 'hello',
        computerUseEnabled: true,
        useLoggedInServices: true,
        budgetLimit: 5.0,
      });

      expect(useStore.getState().computerUseEnabled).toBe(true);
      expect(useStore.getState().useLoggedInServices).toBe(true);
      expect(useStore.getState().budgetLimit).toBe(5.0);

      useStore.getState().stopStreaming();
    });

    it('defaults computer use options to logged-out mode', async () => {
      const useStore = createStreamingStore(mockAdapter);

      await useStore.getState().startStreaming({
        taskId: 'task-1',
        conversationId: 'conv-1',
        prompt: 'hello',
      });

      expect(useStore.getState().computerUseEnabled).toBe(false);
      expect(useStore.getState().useLoggedInServices).toBe(false);
      expect(useStore.getState().budgetLimit).toBeNull();

      useStore.getState().stopStreaming();
    });

    it('aborts existing stream before starting a new one', async () => {
      const firstDisconnect = mock(() => {});
      const secondDisconnect = mock(() => {});
      let callCount = 0;

      const adapter: StreamingStoreAdapter = {
        logger: {
          debug: mock(() => {}),
          info: mock(() => {}),
          warn: mock(() => {}),
          error: mock(() => {}),
        },
        connect: mock(async () => {
          callCount++;
          return callCount === 1 ? firstDisconnect : secondDisconnect;
        }),
      };

      const useStore = createStreamingStore(adapter);

      await useStore
        .getState()
        .startStreaming({ taskId: 'task-1', conversationId: 'c', prompt: 'p' });
      await useStore
        .getState()
        .startStreaming({ taskId: 'task-2', conversationId: 'c', prompt: 'p' });

      expect(firstDisconnect).toHaveBeenCalled();
      expect(useStore.getState().isStreaming).toBe(true);

      useStore.getState().stopStreaming();
    });

    it('resets state from a previous stream before starting a new one', async () => {
      const { adapter, callbacks } = makeAdapter(disconnectMock);
      const useStore = createStreamingStore(adapter);

      await useStore
        .getState()
        .startStreaming({ taskId: 'task-1', conversationId: 'c', prompt: 'p' });
      callbacks.onMessage!(JSON.stringify({ type: 'progress', chunk: 'partial content' }));
      expect(useStore.getState().streamContent).toBe('partial content');

      disconnectMock = mock(() => {});
      await useStore
        .getState()
        .startStreaming({ taskId: 'task-2', conversationId: 'c', prompt: 'p' });
      expect(useStore.getState().streamContent).toBe('');

      useStore.getState().stopStreaming();
    });

    it('ignores late messages and disconnects when stop is called before connect resolves', async () => {
      const callbacks = {
        onMessage: null as ((payload: string) => void) | null,
        onError: null as ((error: any) => void) | null,
        onOpen: null as (() => void) | null,
      };
      const connectGate: { resolve?: () => void } = {};
      const delayedDisconnect = mock(() => {});

      const adapter: StreamingStoreAdapter = {
        logger: {
          debug: mock(() => {}),
          info: mock(() => {}),
          warn: mock(() => {}),
          error: mock(() => {}),
        },
        connect: mock(async (_taskId, onMessage, onError, onOpen) => {
          callbacks.onMessage = onMessage;
          callbacks.onError = onError;
          callbacks.onOpen = onOpen ?? null;
          await new Promise<void>((resolve) => {
            connectGate.resolve = resolve;
          });
          return delayedDisconnect;
        }),
      };

      const useStore = createStreamingStore(adapter);
      const startPromise = useStore.getState().startStreaming({
        taskId: 'task-1',
        conversationId: 'c',
        prompt: 'p',
      });

      useStore.getState().stopStreaming();
      expect(useStore.getState().isStreaming).toBe(false);

      const resolve = connectGate.resolve;
      if (!resolve) {
        throw new Error('Expected connect to be in progress');
      }
      resolve();
      await startPromise;

      callbacks.onMessage?.(JSON.stringify({ type: 'progress', chunk: 'late chunk' }));
      expect(useStore.getState().streamContent).toBe('');
      expect(delayedDisconnect).toHaveBeenCalled();
    });
  });

  describe('stopStreaming', () => {
    it('should stop streaming and clean up', async () => {
      const useStore = createStreamingStore(mockAdapter);

      await useStore.getState().startStreaming({
        taskId: 'test-task',
        conversationId: 'test-conv',
        prompt: 'hello',
      });

      useStore.getState().stopStreaming();

      expect(useStore.getState().isStreaming).toBe(false);
      expect(disconnectMock).toHaveBeenCalled();
    });

    it('survives disconnect errors and still tears down future streams', async () => {
      const secondDisconnect = mock(() => {});
      let connectCount = 0;
      const adapter: StreamingStoreAdapter = {
        logger: {
          debug: mock(() => {}),
          info: mock(() => {}),
          warn: mock(() => {}),
          error: mock(() => {}),
        },
        connect: mock(async () => {
          connectCount += 1;
          if (connectCount === 1) {
            return () => {
              throw new Error('disconnect failed');
            };
          }
          return secondDisconnect;
        }),
      };
      const useStore = createStreamingStore(adapter);

      await useStore.getState().startStreaming({
        taskId: 'task-1',
        conversationId: 'c',
        prompt: 'p',
      });

      expect(() => useStore.getState().stopStreaming()).not.toThrow();
      expect(useStore.getState().isStreaming).toBe(false);

      await useStore.getState().startStreaming({
        taskId: 'task-2',
        conversationId: 'c',
        prompt: 'p',
      });
      useStore.getState().stopStreaming();

      expect(secondDisconnect).toHaveBeenCalledTimes(1);
      expect((adapter.logger.error as any).mock.calls.length).toBeGreaterThan(0);
    });

    it('clears streamContent on abort', async () => {
      const { adapter, callbacks } = makeAdapter(disconnectMock);
      const useStore = createStreamingStore(adapter);

      await useStore
        .getState()
        .startStreaming({ taskId: 'task-1', conversationId: 'c', prompt: 'p' });
      callbacks.onMessage!(JSON.stringify({ type: 'progress', chunk: 'some content' }));
      expect(useStore.getState().streamContent).toBe('some content');

      useStore.getState().stopStreaming();
      expect(useStore.getState().streamContent).toBe('');
    });

    it('calls onSettled with abort reason when stopStreaming is called', async () => {
      const onSettled = mock(() => {});
      const useStore = createStreamingStore(mockAdapter);

      await useStore.getState().startStreaming({
        taskId: 'task-1',
        conversationId: 'c',
        prompt: 'p',
        onSettled,
      });

      useStore.getState().stopStreaming();
      expect(onSettled).toHaveBeenCalledWith('abort');
    });
  });

  describe('SSE message handling', () => {
    it('updates streamContent on progress payload', async () => {
      const { adapter, callbacks } = makeAdapter(disconnectMock);
      const useStore = createStreamingStore(adapter);

      await useStore
        .getState()
        .startStreaming({ taskId: 'task-1', conversationId: 'c', prompt: 'p' });
      callbacks.onMessage!(JSON.stringify({ type: 'progress', chunk: 'Hello world' }));

      expect(useStore.getState().streamContent).toBe('Hello world');
      useStore.getState().stopStreaming();
    });

    it('updates modelId on start payload', async () => {
      const { adapter, callbacks } = makeAdapter(disconnectMock);
      const useStore = createStreamingStore(adapter);

      await useStore
        .getState()
        .startStreaming({ taskId: 'task-1', conversationId: 'c', prompt: 'p' });
      callbacks.onMessage!(JSON.stringify({ type: 'start', model_id: 'claude-opus-4-6' }));

      expect(useStore.getState().modelId).toBe('claude-opus-4-6');
      useStore.getState().stopStreaming();
    });

    it('sets finalResponse and closes stream on complete payload', async () => {
      const onSettled = mock(() => {});
      const { adapter, callbacks } = makeAdapter(disconnectMock);
      const useStore = createStreamingStore(adapter);

      await useStore.getState().startStreaming({
        taskId: 'task-1',
        conversationId: 'c',
        prompt: 'p',
        onSettled,
      });
      callbacks.onMessage!(JSON.stringify({ type: 'complete', message: 'Done!' }));

      expect(useStore.getState().finalResponse).toBe('Done!');
      expect(useStore.getState().isStreaming).toBe(false);
      expect(onSettled).toHaveBeenCalledWith('complete');
    });

    it('preserves streamContent after complete (not cleared)', async () => {
      const { adapter, callbacks } = makeAdapter(disconnectMock);
      const useStore = createStreamingStore(adapter);

      await useStore
        .getState()
        .startStreaming({ taskId: 'task-1', conversationId: 'c', prompt: 'p' });
      callbacks.onMessage!(JSON.stringify({ type: 'complete', message: 'Final answer' }));

      // On complete, streamContent should be set to the message, not cleared
      expect(useStore.getState().streamContent).toBe('Final answer');
    });

    it('sets errorMessage and closes stream on error payload', async () => {
      const onSettled = mock(() => {});
      const { adapter, callbacks } = makeAdapter(disconnectMock);
      const useStore = createStreamingStore(adapter);

      await useStore.getState().startStreaming({
        taskId: 'task-1',
        conversationId: 'c',
        prompt: 'p',
        onSettled,
      });
      callbacks.onMessage!(JSON.stringify({ type: 'error', error: 'Something went wrong' }));

      expect(useStore.getState().errorMessage).toBe('Something went wrong');
      expect(useStore.getState().isStreaming).toBe(false);
      expect(onSettled).toHaveBeenCalledWith('error');
    });

    it('accumulates reasoning across multiple progress payloads', async () => {
      const { adapter, callbacks } = makeAdapter(disconnectMock);
      const useStore = createStreamingStore(adapter);

      await useStore
        .getState()
        .startStreaming({ taskId: 'task-1', conversationId: 'c', prompt: 'p' });
      callbacks.onMessage!(JSON.stringify({ type: 'progress', reasoning: 'Step one.' }));
      callbacks.onMessage!(JSON.stringify({ type: 'progress', reasoning: ' Step two.' }));

      expect(useStore.getState().reasoning).toBe('Step one. Step two.');
      useStore.getState().stopStreaming();
    });

    it('drops malformed SSE payload with a warning log', async () => {
      const { adapter, callbacks } = makeAdapter(disconnectMock);
      const useStore = createStreamingStore(adapter);

      await useStore
        .getState()
        .startStreaming({ taskId: 'task-1', conversationId: 'c', prompt: 'p' });
      callbacks.onMessage!('not valid json {{{');

      expect((adapter.logger.warn as any).mock.calls.length).toBeGreaterThan(0);
      // State should be unchanged (still streaming)
      expect(useStore.getState().isStreaming).toBe(true);

      useStore.getState().stopStreaming();
    });

    it('ignores empty SSE payload without error', async () => {
      const { adapter, callbacks } = makeAdapter(disconnectMock);
      const useStore = createStreamingStore(adapter);

      await useStore
        .getState()
        .startStreaming({ taskId: 'task-1', conversationId: 'c', prompt: 'p' });
      expect(() => callbacks.onMessage!('')).not.toThrow();
      expect(useStore.getState().isStreaming).toBe(true);

      useStore.getState().stopStreaming();
    });

    it('updates currentSpend on budget_usage in progress payload', async () => {
      const { adapter, callbacks } = makeAdapter(disconnectMock);
      const useStore = createStreamingStore(adapter);

      await useStore
        .getState()
        .startStreaming({ taskId: 'task-1', conversationId: 'c', prompt: 'p' });
      callbacks.onMessage!(
        JSON.stringify({ type: 'progress', budget_usage: { consumedUsd: 0.12 } })
      );

      expect(useStore.getState().currentSpend).toBe(0.12);
      useStore.getState().stopStreaming();
    });

    it('calls onConversationId when conversation_id arrives in complete payload', async () => {
      const onConversationId = mock(() => {});
      const { adapter, callbacks } = makeAdapter(disconnectMock);
      const useStore = createStreamingStore(adapter);

      await useStore.getState().startStreaming({
        taskId: 'task-1',
        conversationId: 'c',
        prompt: 'p',
        onConversationId,
      });
      callbacks.onMessage!(JSON.stringify({ type: 'complete', conversation_id: 42 }));

      expect(onConversationId).toHaveBeenCalledWith(42);
    });

    it('calls onApproval when pending_approval arrives', async () => {
      const onApproval = mock(() => {});
      const { adapter, callbacks } = makeAdapter(disconnectMock);
      const useStore = createStreamingStore(adapter);
      const approval = { permission: 'fs.read', agentName: 'agent-1', patterns: [], metadata: {} };

      await useStore.getState().startStreaming({
        taskId: 'task-1',
        conversationId: 'c',
        prompt: 'p',
        onApproval,
      });
      callbacks.onMessage!(JSON.stringify({ type: 'progress', pending_approval: approval }));

      expect(onApproval).toHaveBeenCalledWith(approval);
      expect(useStore.getState().pendingApproval).toEqual(approval);
      useStore.getState().stopStreaming();
    });
  });

  describe('runtime error handling', () => {
    it('closes stream on runtime onError callback', async () => {
      const onSettled = mock(() => {});
      const { adapter, callbacks } = makeAdapter(disconnectMock);
      const useStore = createStreamingStore(adapter);

      await useStore.getState().startStreaming({
        taskId: 'task-1',
        conversationId: 'c',
        prompt: 'p',
        onSettled,
      });
      callbacks.onError!(new Error('connection dropped'));

      expect(useStore.getState().isStreaming).toBe(false);
      expect(useStore.getState().errorMessage).toBe('Streaming failed');
      expect(onSettled).toHaveBeenCalledWith('error');
    });

    it('should handle connection rejection with generic error message', async () => {
      (mockAdapter.connect as any).mockRejectedValue(new Error('Connection failed'));
      const useStore = createStreamingStore(mockAdapter);

      try {
        await useStore.getState().startStreaming({
          taskId: 'test-task',
          conversationId: 'test-conv',
          prompt: 'hello',
        });
      } catch {
        // expected
      }

      expect(useStore.getState().isStreaming).toBe(false);
      expect(useStore.getState().errorMessage).toBe('Streaming failed');
    });

    it('uses specific timeout error message when connection times out', async () => {
      (mockAdapter.connect as any).mockRejectedValue(new Error('Streaming connection timed out'));
      const useStore = createStreamingStore(mockAdapter);

      try {
        await useStore.getState().startStreaming({
          taskId: 'task-1',
          conversationId: 'c',
          prompt: 'p',
        });
      } catch {
        // expected
      }

      expect(useStore.getState().errorMessage).toBe('Streaming connection timed out');
    });
  });

  describe('onSettled callback', () => {
    it('calls onSettled with complete reason when stream completes', async () => {
      const onSettled = mock(() => {});
      const { adapter, callbacks } = makeAdapter(disconnectMock);
      const useStore = createStreamingStore(adapter);

      await useStore.getState().startStreaming({
        taskId: 'task-1',
        conversationId: 'c',
        prompt: 'p',
        onSettled,
      });
      callbacks.onMessage!(JSON.stringify({ type: 'complete' }));

      expect(onSettled).toHaveBeenCalledWith('complete');
    });

    it('calls onSettled with error reason on error payload', async () => {
      const onSettled = mock(() => {});
      const { adapter, callbacks } = makeAdapter(disconnectMock);
      const useStore = createStreamingStore(adapter);

      await useStore.getState().startStreaming({
        taskId: 'task-1',
        conversationId: 'c',
        prompt: 'p',
        onSettled,
      });
      callbacks.onMessage!(JSON.stringify({ type: 'error', error: 'boom' }));

      expect(onSettled).toHaveBeenCalledWith('error');
    });

    it('does not crash if onSettled throws', async () => {
      const onSettled = mock(() => {
        throw new Error('onSettled exploded');
      });
      const { adapter, callbacks } = makeAdapter(disconnectMock);
      const useStore = createStreamingStore(adapter);

      await useStore.getState().startStreaming({
        taskId: 'task-1',
        conversationId: 'c',
        prompt: 'p',
        onSettled,
      });

      expect(() => {
        callbacks.onMessage!(JSON.stringify({ type: 'complete' }));
      }).not.toThrow();

      expect((adapter.logger.error as any).mock.calls.length).toBeGreaterThan(0);
    });
  });

  describe('close behavior', () => {
    it('clears sources, toolEvents, and reasoning on non-complete close', async () => {
      const { adapter, callbacks } = makeAdapter(disconnectMock);
      const useStore = createStreamingStore(adapter);

      await useStore
        .getState()
        .startStreaming({ taskId: 'task-1', conversationId: 'c', prompt: 'p' });
      callbacks.onMessage!(JSON.stringify({ type: 'error', error: 'fail' }));

      expect(useStore.getState().sources).toEqual([]);
      expect(useStore.getState().toolEvents).toEqual([]);
      expect(useStore.getState().reasoning).toBe('');
      expect(useStore.getState().finalReasoning).toBeNull();
    });
  });

  describe('reset', () => {
    it('resets all state to initial values', async () => {
      const { adapter, callbacks } = makeAdapter(disconnectMock);
      const useStore = createStreamingStore(adapter);

      await useStore
        .getState()
        .startStreaming({ taskId: 'task-1', conversationId: 'c', prompt: 'p' });
      callbacks.onMessage!(JSON.stringify({ type: 'progress', chunk: 'some content' }));

      useStore.getState().reset();

      const state = useStore.getState();
      expect(state.isStreaming).toBe(false);
      expect(state.streamContent).toBe('');
      expect(state.errorMessage).toBeNull();
      expect(state.sources).toEqual([]);
      expect(state.finalResponse).toBeNull();
    });
  });

  describe('clearErrorMessage and setErrorMessage', () => {
    it('clearErrorMessage removes error state', async () => {
      (mockAdapter.connect as any).mockRejectedValue(new Error('fail'));
      const useStore = createStreamingStore(mockAdapter);

      try {
        await useStore
          .getState()
          .startStreaming({ taskId: 'task-1', conversationId: 'c', prompt: 'p' });
      } catch {
        /* expected rejection */
      }

      expect(useStore.getState().errorMessage).not.toBeNull();
      useStore.getState().clearErrorMessage();
      expect(useStore.getState().errorMessage).toBeNull();
      expect(useStore.getState().rateLimitResetTime).toBeNull();
    });

    it('setErrorMessage sets error and optional resetTime', () => {
      const useStore = createStreamingStore(mockAdapter);

      useStore.getState().setErrorMessage('Rate limited', '2026-02-21T12:00:00Z');

      expect(useStore.getState().errorMessage).toBe('Rate limited');
      expect(useStore.getState().rateLimitResetTime).toBe('2026-02-21T12:00:00Z');
    });

    it('setErrorMessage without resetTime sets rateLimitResetTime to null', () => {
      const useStore = createStreamingStore(mockAdapter);

      useStore.getState().setErrorMessage('Something failed');

      expect(useStore.getState().errorMessage).toBe('Something failed');
      expect(useStore.getState().rateLimitResetTime).toBeNull();
    });
  });
});
