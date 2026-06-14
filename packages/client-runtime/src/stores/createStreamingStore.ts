import { create } from 'zustand';
import {
  handleStreamingPayload,
  type StreamingEngineContext,
  type StreamingSetters,
} from '@taskforceai/shared/streaming/engine';
import {
  initialStreamingState,
  type StreamingState,
  type StreamSettlement,
} from '@taskforceai/shared/streaming/state';
import { parseStreamingPayload } from '@taskforceai/shared/streaming/schema';
import type {
  PendingApproval,
  SourceReference,
  ToolUsageEvent,
} from '@taskforceai/shared/streaming/types';

export type { StreamSettlement };

export interface StartStreamingOptions {
  taskId: string;
  conversationId: string;
  prompt: string;
  agentCount?: number;
  agentLabels?: string[];
  computerUseEnabled?: boolean;
  useLoggedInServices?: boolean;
  budgetLimit?: number;
  onSettled?: (reason: StreamSettlement) => void;
  onConversationId?: (conversationId: number) => void;
  onApproval?: (approval: PendingApproval | null) => void;
}

export type PrepareStreamingOptions = Omit<
  StartStreamingOptions,
  'taskId' | 'onSettled' | 'onConversationId' | 'onApproval'
>;

export interface StreamingStoreState extends StreamingState {
  prepareStreaming: (options: PrepareStreamingOptions) => void;
  failPreparedStreaming: (message: string, resetTime?: string) => void;
  startStreaming: (options: StartStreamingOptions) => Promise<void>;
  stopStreaming: () => void;
  cancelStreaming: () => Promise<void>;
  clearErrorMessage: () => void;
  setErrorMessage: (message: string, resetTime?: string) => void;
  reset: () => void;
}

export interface StreamingStoreAdapter {
  connect: (
    taskId: string,
    onMessage: (payload: string) => void,
    onError: (error: unknown) => void,
    onOpen?: () => void
  ) => Promise<() => void>;
  cancelTask?: (taskId: string) => Promise<void>;
  debug?: boolean;
  logger: {
    debug: (msg: string, metadata?: unknown) => void;
    info: (msg: string, metadata?: unknown) => void;
    warn: (msg: string, metadata?: unknown) => void;
    error: (msg: string, metadata?: unknown) => void;
  };
}

interface StoreInternals {
  activeTask: StartStreamingOptions | null;
  isClosing: boolean;
  streamStartTime: number | null;
  agentCount: number | null;
  agentLabels: string[];
  reasoning: string;
  ttftReported: boolean;
  sources: SourceReference[];
  toolEvents: ToolUsageEvent[];
  elapsedTimer: ReturnType<typeof setInterval> | null;
  disconnectFn: (() => void) | null;
  streamId: number;
}

export const createStreamingStore = (adapter: StreamingStoreAdapter) => {
  const internals: StoreInternals = {
    activeTask: null,
    isClosing: false,
    streamStartTime: null,
    agentCount: null,
    agentLabels: [],
    reasoning: '',
    ttftReported: false,
    sources: [],
    toolEvents: [],
    elapsedTimer: null,
    disconnectFn: null,
    streamId: 0,
  };

  const closeStream = (
    reason: StreamSettlement,
    set: (partial: Partial<StreamingStoreState>) => void,
    get: () => StreamingStoreState
  ) => {
    if (internals.isClosing) return;
    internals.isClosing = true;

    try {
      internals.streamId += 1;

      const disconnect = internals.disconnectFn;
      internals.disconnectFn = null;
      if (disconnect) {
        try {
          disconnect();
        } catch (error) {
          adapter.logger.error('[StreamingStore] Failed to disconnect stream', {
            error,
            reason,
          });
        }
      }

      if (internals.elapsedTimer) {
        clearInterval(internals.elapsedTimer);
        internals.elapsedTimer = null;
      }

      const activeTask = internals.activeTask;
      internals.activeTask = null;

      if (reason !== 'complete') {
        internals.sources = [];
        internals.toolEvents = [];
        internals.reasoning = '';
        internals.agentCount = null;
        internals.agentLabels = [];
        internals.ttftReported = false;

        set({
          modelId: null,
          modelLabel: null,
          modelBadge: null,
          trace_id: null,
          pendingApproval: null,
          sources: [],
          finalSources: [],
          toolEvents: [],
          finalToolEvents: [],
          reasoning: '',
          finalReasoning: null,
          agentStatuses: [],
          agentLabels: [],
          streamContent: reason === 'abort' ? '' : get().streamContent,
        });
      }

      if (activeTask?.onSettled) {
        try {
          const result = activeTask.onSettled(reason) as unknown;
          if (result instanceof Promise) {
            void result.catch((error) => {
              adapter.logger.error('Error in async onSettled callback', { error, reason });
            });
          }
        } catch (error) {
          adapter.logger.error('Error in onSettled callback', { error, reason });
        }
      }
    } finally {
      internals.isClosing = false;
    }
  };

  const startElapsedTimer = (set: (partial: Partial<StreamingStoreState>) => void) => {
    if (internals.elapsedTimer) {
      clearInterval(internals.elapsedTimer);
    }

    internals.elapsedTimer = setInterval(() => {
      if (internals.streamStartTime) {
        const elapsed = Math.floor((Date.now() - internals.streamStartTime) / 1000);
        set({ elapsedSeconds: elapsed });
      }
    }, 1000);
  };

  const initialAgentStatusesFor = (options: { agentCount?: number; agentLabels?: string[] }) =>
    options.agentCount
      ? Array.from({ length: options.agentCount }, (_unused, index) => ({
          agent_id: index,
          status: 'QUEUED',
          progress: 0.05,
          ...(options.agentLabels?.[index] ? { model: options.agentLabels[index] } : {}),
        }))
      : [];

  const prepareState = (
    options: PrepareStreamingOptions,
    set: (partial: Partial<StreamingStoreState>) => void,
    get: () => StreamingStoreState
  ) => {
    closeStream('abort', set, get);

    const initialAgentStatuses = initialAgentStatusesFor(options);

    set({
      ...initialStreamingState,
      isStreaming: true,
      computerUseEnabled: options.computerUseEnabled ?? false,
      useLoggedInServices: options.useLoggedInServices ?? false,
      budgetLimit: options.budgetLimit ?? null,
      agentStatuses: initialAgentStatuses,
      agentLabels: options.agentLabels ?? [],
    });

    internals.activeTask = null;
    internals.streamStartTime = Date.now();
    internals.agentCount = options.agentCount ?? null;
    internals.ttftReported = false;
    internals.reasoning = '';
    internals.sources = [];
    internals.toolEvents = [];
    internals.agentLabels = options.agentLabels ?? [];
    internals.streamId += 1;
    startElapsedTimer(set);
  };

  return create<StreamingStoreState>((set, get) => ({
    ...initialStreamingState,

    prepareStreaming: (options: PrepareStreamingOptions): void => {
      if (adapter.debug) {
        adapter.logger.debug('[StreamingStore] prepareStreaming invoked');
      }
      prepareState(options, set, get);
    },

    failPreparedStreaming: (message: string, resetTime?: string): void => {
      closeStream('error', set, get);
      set({
        isStreaming: false,
        errorMessage: message,
        rateLimitResetTime: resetTime ?? null,
      });
    },

    startStreaming: async (options: StartStreamingOptions): Promise<void> => {
      if (adapter.debug) {
        adapter.logger.debug('[StreamingStore] startStreaming invoked', {
          taskId: options.taskId,
        });
      }

      const hasPreparedState =
        get().isStreaming && !internals.activeTask && !internals.disconnectFn;
      if (!hasPreparedState) {
        prepareState(options, set, get);
      }

      internals.activeTask = options;
      internals.agentCount = options.agentCount ?? null;
      internals.ttftReported = false;
      internals.agentLabels = options.agentLabels ?? [];
      internals.streamId += 1;
      const currentStreamId = internals.streamId;

      startElapsedTimer(set);

      const setters: StreamingSetters = {
        setModelId: (value) => set({ modelId: value }),
        setModelLabel: (value) => set({ modelLabel: value }),
        setModelBadge: (value) => set({ modelBadge: value }),
        setAgentStatuses: (value) => set({ agentStatuses: value }),
        setSources: (value) => set({ sources: value }),
        setFinalSources: (value) => set({ finalSources: value }),
        setToolEvents: (value) => set({ toolEvents: value }),
        setFinalToolEvents: (value) => set({ finalToolEvents: value }),
        setReasoning: (value) => set({ reasoning: value }),
        setFinalReasoning: (value) => set({ finalReasoning: value }),
        setFinalResponse: (value) => set({ finalResponse: value }),
        setStreamContent: (value) => set({ streamContent: value }),
        setTraceId: (value) => set({ trace_id: value }),
        setPendingApproval: (value) => set({ pendingApproval: value }),
        setElapsedSeconds: (value) => set({ elapsedSeconds: value }),
        setIsStreaming: (value) => set({ isStreaming: value }),
        setErrorMessage: (message, resetTime) =>
          set({ errorMessage: message, rateLimitResetTime: resetTime ?? null }),
        setCurrentSpend: (value) => set({ currentSpend: value }),
        closeStream: (reason) => closeStream(reason, set, get),
        onConversationId: options.onConversationId,
        onApproval: options.onApproval,
      };

      try {
        const disconnect = await adapter.connect(
          options.taskId,
          (payloadStr: string) => {
            if (currentStreamId !== internals.streamId || !payloadStr) {
              return;
            }

            const parseResult = parseStreamingPayload(payloadStr);
            if (!parseResult.ok) {
              adapter.logger.warn('[StreamingStore] Dropped malformed SSE payload', {
                error: parseResult.error,
              });
              return;
            }

            const ctx: StreamingEngineContext = {
              state: get(),
              setters,
              refs: {
                sources: internals.sources,
                toolEvents: internals.toolEvents,
                reasoning: internals.reasoning,
                agentCount: internals.agentCount,
                agentLabels: internals.agentLabels,
                streamStartTime: internals.streamStartTime,
                ttftReported: internals.ttftReported,
              },
              debug: adapter.debug ?? false,
              logger: adapter.logger,
            };

            handleStreamingPayload(ctx, parseResult.value);

            internals.sources = ctx.refs.sources;
            internals.toolEvents = ctx.refs.toolEvents;
            internals.reasoning = ctx.refs.reasoning;
            internals.agentCount = ctx.refs.agentCount;
            internals.ttftReported = ctx.refs.ttftReported;
          },
          (error: unknown) => {
            if (currentStreamId !== internals.streamId) {
              return;
            }

            adapter.logger.error('[StreamingStore] Streaming runtime error', error);
            closeStream('error', set, get);
            const state = get();
            if (!state.errorMessage) {
              set({ isStreaming: false, errorMessage: 'Streaming failed' });
            } else {
              set({ isStreaming: false });
            }
          },
          () => {
            if (currentStreamId !== internals.streamId) {
              return;
            }
            if (adapter.debug) {
              adapter.logger.debug('[StreamingStore] Streaming connected');
            }
          }
        );

        if (currentStreamId !== internals.streamId) {
          disconnect();
          return;
        }

        internals.disconnectFn = disconnect;
      } catch (error) {
        if (currentStreamId !== internals.streamId) {
          return;
        }

        adapter.logger.error('Streaming connection failed', { error });
        closeStream('error', set, get);
        set({
          isStreaming: false,
          errorMessage:
            error instanceof Error && error.message === 'Streaming connection timed out'
              ? 'Streaming connection timed out'
              : 'Streaming failed',
        });
        throw error;
      }
    },

    stopStreaming: () => {
      closeStream('abort', set, get);
      set({ isStreaming: false });
    },

    cancelStreaming: async () => {
      const taskId = internals.activeTask?.taskId;
      closeStream('abort', set, get);
      set({ isStreaming: false });

      if (!taskId || !adapter.cancelTask) {
        return;
      }

      try {
        await adapter.cancelTask(taskId);
      } catch (error) {
        adapter.logger.error('[StreamingStore] Failed to cancel task', { error, taskId });
        set({ errorMessage: 'Failed to stop run' });
      }
    },

    clearErrorMessage: () => {
      set({ errorMessage: null, rateLimitResetTime: null });
    },

    setErrorMessage: (message: string, resetTime?: string) => {
      set({ errorMessage: message, rateLimitResetTime: resetTime ?? null });
    },

    reset: () => {
      closeStream('abort', set, get);
      set(initialStreamingState);
    },
  }));
};
