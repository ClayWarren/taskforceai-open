import {
  createStreamingPair,
  finalizeStreamingPair,
  persistStreamingError,
} from '@taskforceai/shared/streaming/lifecycle-effects';
import type { MessagePairIds } from '@taskforceai/shared/streaming/lifecycle-effects';
import {
  applyStreamingErrorMessage,
  finalizeStreamingMessages,
  updateStreamingContentAndStatusMessages,
  type StreamingMessageLike,
  type StreamingPairPayload,
} from '@taskforceai/shared/streaming/message-updates';
import { createId } from '@taskforceai/shared/utils/id';
import { useEffect, useRef } from 'react';
import { useStreamingLifecycle } from './useStreamingLifecycle';

type Logger = {
  debug?: (message: string, metadata?: unknown) => void;
  error: (message: string, metadata?: unknown) => void;
};

type SetMessages<TMessage> = React.Dispatch<React.SetStateAction<TMessage[]>>;

export interface ManagedStreamingPersistence<TSource, TTool, TAgent, TApproval> {
  persistPlaceholderPair: (conversationId: string, ids: MessagePairIds) => Promise<void>;
  rollbackPlaceholderPair?: (
    ids: MessagePairIds,
    conversationId: string | null
  ) => void | Promise<void>;
  persistLiveContent: (payload: {
    conversationId: string;
    ids: MessagePairIds;
    content: string;
  }) => Promise<void> | void;
  persistLiveStatus?: (payload: {
    conversationId: string;
    ids: MessagePairIds;
    elapsedSeconds: number;
    toolEvents: TTool[];
    agentStatuses: TAgent[];
    pendingApproval: TApproval | null;
  }) => Promise<void> | void;
  persistToolEvents?: (payload: {
    conversationId: string | null;
    ids: MessagePairIds;
    toolEvents: TTool[];
  }) => Promise<void> | void;
  persistAgentStatuses?: (payload: {
    conversationId: string;
    ids: MessagePairIds;
    elapsedSeconds: number;
    toolEvents: TTool[];
    agentStatuses: TAgent[];
    pendingApproval: TApproval | null;
  }) => Promise<void> | void;
  flushBeforeFinalState?: () => Promise<void>;
  flushBeforeErrorState?: () => Promise<void>;
  persistFinalState: (
    conversationId: string,
    ids: MessagePairIds,
    payload: StreamingPairPayload<TSource, TTool, TAgent>
  ) => Promise<void>;
  persistErrorState: (
    conversationId: string,
    contentMessageId: string,
    message: string
  ) => Promise<void>;
}

export interface ManagedStreamingMessagesOptions<
  TMessage extends StreamingMessageLike<TSource, TTool, TAgent>,
  TSource,
  TTool,
  TAgent,
  TApproval = unknown,
> {
  isStreaming: boolean;
  streamContent: string;
  finalResponse: string | null;
  errorMessage: string | null;
  conversationId: string | null;
  ensureActiveConversation: () => Promise<string>;
  setMessages: SetMessages<TMessage>;
  sources: TSource[];
  finalSources: TSource[];
  toolEvents: TTool[];
  finalToolEvents: TTool[];
  elapsedSeconds: number;
  agentStatuses: TAgent[];
  pendingApproval?: TApproval | null;
  traceId?: string | null;
  resetWhenIdle?: boolean;
  finalizeFrom: 'prop' | 'state';
  clearSourcesOnError?: boolean;
  createPlaceholders: (ids: MessagePairIds) => {
    statusPlaceholder: TMessage;
    contentPlaceholder: TMessage;
  };
  persistence: ManagedStreamingPersistence<TSource, TTool, TAgent, TApproval>;
  logger: Logger;
  debug?: boolean;
  onFinalized?: (payload: {
    conversationId: string;
    ids: MessagePairIds;
    finalResponse: string;
  }) => void | Promise<void>;
  onErrorPersisted?: (payload: {
    conversationId: string;
    contentMessageId: string;
    message: string;
  }) => void | Promise<void>;
  enhanceLiveMessages?: (
    messages: TMessage[],
    payload: {
      ids: MessagePairIds;
      content: string;
      agentStatuses: TAgent[];
      elapsedSeconds: number;
      toolEvents: TTool[];
      pendingApproval: TApproval | null;
    }
  ) => TMessage[];
  resolveFinalSources?: (payload: {
    finalResponse: string;
    sources: TSource[];
    finalSources: TSource[];
    toolEvents: TTool[];
    finalToolEvents: TTool[];
  }) => TSource[];
  afterFinalState?: 'reset' | 'dispatch-final';
  afterErrorState?: 'reset' | 'dispatch-error';
}

export interface ManagedStreamingState {
  streamingMessageId: string | null;
  resetStreamingState: () => void;
}

export function useManagedStreamingMessages<
  TMessage extends StreamingMessageLike<TSource, TTool, TAgent>,
  TSource = unknown,
  TTool = unknown,
  TAgent = unknown,
  TApproval = unknown,
>({
  isStreaming,
  streamContent,
  finalResponse,
  errorMessage,
  conversationId,
  ensureActiveConversation,
  setMessages,
  sources,
  finalSources,
  toolEvents,
  finalToolEvents,
  elapsedSeconds,
  agentStatuses,
  pendingApproval = null,
  traceId = null,
  resetWhenIdle = false,
  finalizeFrom,
  clearSourcesOnError = false,
  createPlaceholders,
  persistence,
  logger,
  debug = false,
  onFinalized,
  onErrorPersisted,
  enhanceLiveMessages,
  resolveFinalSources,
  afterFinalState,
  afterErrorState,
}: ManagedStreamingMessagesOptions<
  TMessage,
  TSource,
  TTool,
  TAgent,
  TApproval
>): ManagedStreamingState {
  const {
    state,
    contentMessageId,
    statusMessageId,
    isMountedRef,
    resolveConversationId,
    dispatchPlaceholderError,
    dispatchPlaceholdersReady,
    dispatchFinalResponse,
    dispatchError,
    resetStreamingState,
  } = useStreamingLifecycle({
    isStreaming,
    streamContent,
    finalResponse,
    errorMessage: finalizeFrom === 'prop' ? null : errorMessage,
    conversationId,
    ensureActiveConversation,
    dispatchFinalResponseOnProp: finalizeFrom === 'state',
    resetWhenIdle,
  });
  const isFinalizingRef = useRef(false);
  const isPersistingErrorRef = useRef(false);
  const lastIdsRef = useRef<MessagePairIds | null>(null);
  const handledFinalKeyRef = useRef<string | null>(null);
  const handledErrorKeyRef = useRef<string | null>(null);
  const latestCompletionMetadataRef = useRef({
    sources,
    finalSources,
    toolEvents,
    finalToolEvents,
  });
  latestCompletionMetadataRef.current = {
    sources,
    finalSources,
    toolEvents,
    finalToolEvents,
  };

  if (statusMessageId && contentMessageId) {
    lastIdsRef.current = { statusMessageId, contentMessageId };
  }

  if (!errorMessage && state.state !== 'error') {
    handledErrorKeyRef.current = null;
  }
  if (finalResponse === null && state.state !== 'finalizing') {
    handledFinalKeyRef.current = null;
  }

  useEffect(() => {
    if (state.state !== 'awaitingPlaceholder') return;
    let cancelled = false;

    const createPair = async () => {
      try {
        await createStreamingPair({
          scope: {
            isActive: () => !cancelled && isMountedRef.current,
            resolveConversationId,
          },
          createIds: () => {
            const ids = {
              statusMessageId: createId('assistant'),
              contentMessageId: createId('assistant'),
            };
            if (debug) {
              logger.debug?.('[useManagedStreamingMessages] Creating placeholders', ids);
            }
            return ids;
          },
          insertLocalPlaceholders: (ids) => {
            const { statusPlaceholder, contentPlaceholder } = createPlaceholders(ids);
            setMessages((previous) => [...previous, statusPlaceholder, contentPlaceholder]);
          },
          persistPlaceholderPair: persistence.persistPlaceholderPair,
          rollbackLocalPlaceholders: persistence.rollbackPlaceholderPair,
          onReady: dispatchPlaceholdersReady,
        });
      } catch (error) {
        logger.error('[useManagedStreamingMessages] Failed to create placeholders', { error });
        if (!cancelled && isMountedRef.current) {
          dispatchPlaceholderError();
        }
      }
    };

    void createPair();
    return () => {
      cancelled = true;
    };
  }, [
    createPlaceholders,
    debug,
    dispatchPlaceholderError,
    dispatchPlaceholdersReady,
    isMountedRef,
    logger,
    persistence,
    resolveConversationId,
    setMessages,
    state.state,
  ]);

  useEffect(() => {
    if (state.state !== 'streaming' || !state.bufferedContent) return;
    const ids = {
      statusMessageId: state.statusMessageId,
      contentMessageId: state.contentMessageId,
    };
    let cancelled = false;

    const updateContent = async () => {
      try {
        const activeConversationId = conversationId ?? (await ensureActiveConversation());
        if (cancelled || !isMountedRef.current) return;

        const payload = {
          ids,
          content: state.bufferedContent ?? '',
          agentStatuses,
          elapsedSeconds,
          toolEvents,
          pendingApproval,
        };
        setMessages((previous) =>
          enhanceLiveMessages
            ? enhanceLiveMessages(previous, payload)
            : updateStreamingContentAndStatusMessages<TMessage, TSource, TTool, TAgent>(
                previous,
                payload
              )
        );

        if (cancelled || !isMountedRef.current) return;
        await persistence.persistLiveContent({
          conversationId: activeConversationId,
          ids,
          content: state.bufferedContent ?? '',
        });

        if (cancelled || !isMountedRef.current || !persistence.persistLiveStatus) return;
        await persistence.persistLiveStatus({
          conversationId: activeConversationId,
          ids,
          elapsedSeconds,
          toolEvents,
          agentStatuses,
          pendingApproval,
        });
      } catch (error) {
        if (!cancelled && isMountedRef.current) {
          logger.error('[useManagedStreamingMessages] Failed to update streaming content', {
            error,
          });
        }
      }
    };

    void updateContent();
    return () => {
      cancelled = true;
    };
  }, [
    agentStatuses,
    conversationId,
    elapsedSeconds,
    enhanceLiveMessages,
    ensureActiveConversation,
    isMountedRef,
    logger,
    pendingApproval,
    persistence,
    setMessages,
    state,
    toolEvents,
  ]);

  useEffect(() => {
    if (!persistence.persistToolEvents || state.state !== 'streaming') return;
    const ids = {
      statusMessageId: state.statusMessageId,
      contentMessageId: state.contentMessageId,
    };
    setMessages((previous) =>
      previous.map((message) =>
        message.id === ids.statusMessageId ? { ...message, toolEvents } : message
      )
    );
    void Promise.resolve(
      persistence.persistToolEvents({
        conversationId,
        ids,
        toolEvents,
      })
    ).catch((error) => {
      if (isMountedRef.current) {
        logger.error('[useManagedStreamingMessages] Failed to persist tool events', { error });
      }
    });
  }, [conversationId, isMountedRef, logger, persistence, setMessages, state, toolEvents]);

  useEffect(() => {
    if (
      !persistence.persistAgentStatuses ||
      state.state !== 'streaming' ||
      agentStatuses.length === 0
    ) {
      return;
    }
    const ids = {
      statusMessageId: state.statusMessageId,
      contentMessageId: state.contentMessageId,
    };
    let cancelled = false;

    const updateStatuses = async () => {
      try {
        const activeConversationId = conversationId ?? (await ensureActiveConversation());
        if (cancelled || !isMountedRef.current) return;

        setMessages((previous) =>
          previous.map((message) =>
            message.id === ids.statusMessageId && message.isAgentStatus
              ? {
                  ...message,
                  elapsedSeconds,
                  toolEvents: finalToolEvents.length > 0 ? finalToolEvents : toolEvents,
                  agentStatuses,
                  pendingApproval: pendingApproval ?? undefined,
                }
              : message
          )
        );

        if (cancelled || !isMountedRef.current) return;
        await persistence.persistAgentStatuses?.({
          conversationId: activeConversationId,
          ids,
          elapsedSeconds,
          toolEvents: finalToolEvents.length > 0 ? finalToolEvents : toolEvents,
          agentStatuses,
          pendingApproval,
        });
      } catch (error) {
        if (!cancelled && isMountedRef.current) {
          logger.error('[useManagedStreamingMessages] Failed to persist agent statuses', { error });
        }
      }
    };

    void updateStatuses();
    return () => {
      cancelled = true;
    };
  }, [
    agentStatuses,
    conversationId,
    elapsedSeconds,
    ensureActiveConversation,
    finalToolEvents,
    isMountedRef,
    logger,
    pendingApproval,
    persistence,
    setMessages,
    state,
    toolEvents,
  ]);

  useEffect(() => {
    const finalizingFromProp =
      finalizeFrom === 'prop' &&
      finalResponse !== null &&
      (statusMessageId || lastIdsRef.current?.statusMessageId) &&
      (contentMessageId || lastIdsRef.current?.contentMessageId);
    const finalizingFromState =
      finalizeFrom === 'state' &&
      state.state === 'finalizing' &&
      state.finalResponse !== undefined &&
      state.statusMessageId &&
      state.contentMessageId;
    if ((!finalizingFromProp && !finalizingFromState) || isFinalizingRef.current) return;

    const ids = {
      statusMessageId: finalizingFromState
        ? state.statusMessageId!
        : (statusMessageId ?? lastIdsRef.current!.statusMessageId),
      contentMessageId: finalizingFromState
        ? state.contentMessageId!
        : (contentMessageId ?? lastIdsRef.current!.contentMessageId),
    };
    const response = finalizingFromState ? state.finalResponse : finalResponse!;
    const finalKey = `${ids.contentMessageId}:${response}`;
    if (handledFinalKeyRef.current === finalKey) return;
    let cancelled = false;
    isFinalizingRef.current = true;
    handledFinalKeyRef.current = finalKey;
    const completionMetadata = {
      sources: [...latestCompletionMetadataRef.current.sources],
      finalSources: [...latestCompletionMetadataRef.current.finalSources],
      toolEvents: [...latestCompletionMetadataRef.current.toolEvents],
      finalToolEvents: [...latestCompletionMetadataRef.current.finalToolEvents],
    };
    const finalElapsedSeconds = elapsedSeconds;
    const finalAgentStatuses = [...agentStatuses];
    const finalTraceId = traceId;

    const finalize = async () => {
      try {
        await persistence.flushBeforeFinalState?.();
        const resolvedSources = resolveFinalSources
          ? resolveFinalSources({
              finalResponse: response,
              sources: completionMetadata.sources,
              finalSources: completionMetadata.finalSources,
              toolEvents: completionMetadata.toolEvents,
              finalToolEvents: completionMetadata.finalToolEvents,
            })
          : completionMetadata.finalSources.length > 0
            ? completionMetadata.finalSources
            : completionMetadata.sources;
        const resolvedToolEvents =
          completionMetadata.finalToolEvents.length > 0
            ? completionMetadata.finalToolEvents
            : completionMetadata.toolEvents;
        const payload: StreamingPairPayload<TSource, TTool, TAgent> = {
          finalResponse: response,
          sources: resolvedSources,
          toolEvents: resolvedToolEvents,
          elapsedSeconds: finalElapsedSeconds,
          agentStatuses: finalAgentStatuses,
          ...(finalTraceId !== undefined ? { traceId: finalTraceId } : {}),
          ...(finalizeFrom === 'state' ? { updatedAt: Date.now() } : {}),
        };

        await finalizeStreamingPair({
          scope: {
            isActive: () => !cancelled && isMountedRef.current,
            resolveConversationId,
          },
          ids,
          payload,
          applyLocalFinalState: (nextIds, nextPayload) => {
            setMessages((previous) => finalizeStreamingMessages(previous, nextIds, nextPayload));
          },
          persistFinalState: persistence.persistFinalState,
          onDone: async () => {
            const activeConversationId = await resolveConversationId();
            if (!activeConversationId || cancelled || !isMountedRef.current) return;
            await onFinalized?.({
              conversationId: activeConversationId,
              ids,
              finalResponse: response,
            });
            if (afterFinalState === 'dispatch-final') {
              dispatchFinalResponse(response);
            }
          },
        });
      } catch (error) {
        if (!cancelled && isMountedRef.current) {
          logger.error('[useManagedStreamingMessages] Finalization failed', { error });
        }
      } finally {
        isFinalizingRef.current = false;
        if (!cancelled && isMountedRef.current && afterFinalState === 'reset') {
          resetStreamingState();
        }
      }
    };

    void finalize();
  }, [
    afterFinalState,
    agentStatuses,
    contentMessageId,
    dispatchFinalResponse,
    elapsedSeconds,
    finalResponse,
    finalSources,
    finalToolEvents,
    finalizeFrom,
    isMountedRef,
    logger,
    onFinalized,
    persistence,
    resetStreamingState,
    resolveConversationId,
    resolveFinalSources,
    setMessages,
    sources,
    state,
    statusMessageId,
    toolEvents,
    traceId,
  ]);

  useEffect(() => {
    const errorFromProp =
      finalizeFrom === 'prop' &&
      !!errorMessage &&
      !!(contentMessageId ?? lastIdsRef.current?.contentMessageId);
    const errorFromState =
      finalizeFrom === 'state' && state.state === 'error' && state.contentMessageId;
    if ((!errorFromProp && !errorFromState) || isPersistingErrorRef.current) return;

    const message = errorFromState ? (state.message ?? 'Streaming failed') : errorMessage!;
    const messageId = errorFromState
      ? state.contentMessageId!
      : (contentMessageId ?? lastIdsRef.current!.contentMessageId);
    const errorKey = `${messageId}:${message}`;
    if (handledErrorKeyRef.current === errorKey) return;
    let cancelled = false;
    isPersistingErrorRef.current = true;
    handledErrorKeyRef.current = errorKey;

    const persistError = async () => {
      try {
        await persistence.flushBeforeErrorState?.();
        await persistStreamingError({
          scope: {
            isActive: () => !cancelled && isMountedRef.current,
            resolveConversationId,
          },
          contentMessageId: messageId,
          message,
          applyLocalError: (nextMessageId, nextMessage) => {
            setMessages((previous) =>
              applyStreamingErrorMessage(previous, nextMessageId, nextMessage, {
                clearSources: clearSourcesOnError,
              })
            );
          },
          persistErrorState: persistence.persistErrorState,
          onDone: async () => {
            const activeConversationId = await resolveConversationId();
            if (!activeConversationId || cancelled || !isMountedRef.current) return;
            await onErrorPersisted?.({
              conversationId: activeConversationId,
              contentMessageId: messageId,
              message,
            });
            if (afterErrorState === 'dispatch-error') {
              dispatchError(message);
            }
          },
        });
      } catch (error) {
        if (!cancelled && isMountedRef.current) {
          logger.error('[useManagedStreamingMessages] Failed to handle error state', { error });
          if (afterErrorState === 'dispatch-error') {
            dispatchError(message);
          }
        }
      } finally {
        isPersistingErrorRef.current = false;
        if (!cancelled && isMountedRef.current && afterErrorState === 'reset') {
          resetStreamingState();
        }
      }
    };

    void persistError();
  }, [
    afterErrorState,
    clearSourcesOnError,
    contentMessageId,
    dispatchError,
    errorMessage,
    finalizeFrom,
    isMountedRef,
    logger,
    onErrorPersisted,
    persistence,
    resetStreamingState,
    resolveConversationId,
    setMessages,
    state,
  ]);

  return {
    streamingMessageId: contentMessageId,
    resetStreamingState,
  };
}
