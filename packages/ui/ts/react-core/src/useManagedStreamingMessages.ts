import {
  createStreamingPair,
  finalizeStreamingPair,
  persistStreamingError,
} from '@taskforceai/client-core/streaming/lifecycle-effects';
import type { MessagePairIds } from '@taskforceai/client-core/streaming/lifecycle-effects';
import {
  applyStreamingErrorMessage,
  finalizeStreamingMessages,
  updateStreamingContentAndStatusMessages,
  type StreamingMessageLike,
  type StreamingPairPayload,
} from './streaming-message-updates';
import { createId } from '@taskforceai/client-runtime/id';
import { definedProps } from '@taskforceai/client-core/utils/object';
import type { StreamingLifecycleState } from '@taskforceai/client-core/streaming/lifecycle';
import { useEffect, useRef } from 'react';
import { useStreamingLifecycle } from './useStreamingLifecycle';

type Logger = {
  debug?: (message: string, metadata?: unknown) => void;
  error: (message: string, metadata?: unknown) => void;
};

type SetMessages<TMessage> = React.Dispatch<React.SetStateAction<TMessage[]>>;

type ManagedStatusPatch<TTool, TAgent> = {
  elapsedSeconds?: number;
  toolEvents?: TTool[];
  agentStatuses?: TAgent[];
  pendingApproval?: unknown;
  requireAgentStatus?: boolean;
};

const buildAsyncTargetKey = (
  contentMessageId: string | null | undefined,
  value: string | null | undefined
): string | null =>
  contentMessageId && value !== null && value !== undefined ? `${contentMessageId}:${value}` : null;

type FinalizationTarget = {
  key: string;
  ids: MessagePairIds;
  response: string;
};

const selectFinalizationTarget = ({
  finalizeFrom,
  finalResponse,
  contentMessageId,
  statusMessageId,
  lastIds,
  state,
}: {
  finalizeFrom: 'prop' | 'state';
  finalResponse: string | null;
  contentMessageId: string | null;
  statusMessageId: string | null;
  lastIds: MessagePairIds | null;
  state: StreamingLifecycleState;
}): FinalizationTarget | null => {
  if (finalizeFrom === 'prop') {
    const targetStatusId = statusMessageId ?? lastIds?.statusMessageId;
    const targetContentId = contentMessageId ?? lastIds?.contentMessageId;
    if (!targetStatusId || !targetContentId || finalResponse === null) {
      return null;
    }
    return {
      key: `${targetContentId}:${finalResponse}`,
      ids: { statusMessageId: targetStatusId, contentMessageId: targetContentId },
      response: finalResponse,
    };
  }
  if (state.state !== 'finalizing' || !state.statusMessageId || !state.contentMessageId) {
    return null;
  }
  return {
    key: `${state.contentMessageId}:${state.finalResponse}`,
    ids: {
      statusMessageId: state.statusMessageId,
      contentMessageId: state.contentMessageId,
    },
    response: state.finalResponse,
  };
};

const selectErrorPersistenceTargetKey = ({
  finalizeFrom,
  errorMessage,
  contentMessageId,
  lastIds,
  state,
}: {
  finalizeFrom: 'prop' | 'state';
  errorMessage: string | null;
  contentMessageId: string | null;
  lastIds: MessagePairIds | null;
  state: StreamingLifecycleState;
}): string | null => {
  if (finalizeFrom === 'prop') {
    return buildAsyncTargetKey(contentMessageId ?? lastIds?.contentMessageId, errorMessage);
  }
  if (state.state !== 'error') {
    return null;
  }
  return buildAsyncTargetKey(state.contentMessageId, state.message ?? 'Streaming failed');
};

export const patchManagedStreamingStatusMessage = <
  TMessage extends StreamingMessageLike<unknown, TTool, TAgent> & {
    pendingApproval?: unknown;
  },
  TTool = unknown,
  TAgent = unknown,
>(
  previous: TMessage[],
  statusMessageId: string,
  patch: ManagedStatusPatch<TTool, TAgent>
): TMessage[] => {
  for (let index = previous.length - 1; index >= 0; index -= 1) {
    const message = previous[index];
    if (!message || message.id !== statusMessageId) {
      continue;
    }

    if (patch.requireAgentStatus && !message.isAgentStatus) {
      return previous;
    }

    const next = [...previous];
    next[index] = {
      ...message,
      ...(patch.elapsedSeconds !== undefined ? { elapsedSeconds: patch.elapsedSeconds } : {}),
      ...(patch.toolEvents !== undefined ? { toolEvents: patch.toolEvents } : {}),
      ...(patch.agentStatuses !== undefined ? { agentStatuses: patch.agentStatuses } : {}),
      ...(patch.pendingApproval !== undefined
        ? { pendingApproval: patch.pendingApproval ?? undefined }
        : {}),
    };
    return next;
  }

  return previous;
};

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
  const pendingPlaceholderIdsRef = useRef<MessagePairIds | null>(null);
  const handledFinalKeyRef = useRef<string | null>(null);
  const handledErrorKeyRef = useRef<string | null>(null);
  const finalizationTaskRef = useRef<{ key: string; cancel: () => void } | null>(null);
  const errorPersistenceTaskRef = useRef<{ key: string; cancel: () => void } | null>(null);
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

  const finalizationTarget = selectFinalizationTarget({
    finalizeFrom,
    finalResponse,
    contentMessageId,
    statusMessageId,
    lastIds: lastIdsRef.current,
    state,
  });
  const finalizationTargetKey = finalizationTarget?.key ?? null;
  const errorPersistenceTargetKey = selectErrorPersistenceTargetKey({
    finalizeFrom,
    errorMessage,
    contentMessageId,
    lastIds: lastIdsRef.current,
    state,
  });

  useEffect(
    () => () => {
      const task = finalizationTaskRef.current;
      if (task?.key === finalizationTargetKey) {
        task.cancel();
      }
    },
    [finalizationTargetKey]
  );

  useEffect(
    () => () => {
      const task = errorPersistenceTaskRef.current;
      if (task?.key === errorPersistenceTargetKey) {
        task.cancel();
      }
    },
    [errorPersistenceTargetKey]
  );

  useEffect(() => {
    if (state.state !== 'awaitingPlaceholder') return;
    let cancelled = false;

    const createPair = async () => {
      try {
        const createdIds = await createStreamingPair({
          scope: {
            isActive: () => !cancelled && isMountedRef.current,
            resolveConversationId,
          },
          createIds: () => {
            const ids = {
              statusMessageId: createId('assistant'),
              contentMessageId: createId('assistant'),
            };
            pendingPlaceholderIdsRef.current = ids;
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
          onReady: (ids) => {
            if (pendingPlaceholderIdsRef.current?.contentMessageId === ids.contentMessageId) {
              pendingPlaceholderIdsRef.current = null;
            }
            dispatchPlaceholdersReady(ids);
          },
          ...definedProps({ rollbackLocalPlaceholders: persistence.rollbackPlaceholderPair }),
        });
        if (!createdIds) {
          pendingPlaceholderIdsRef.current = null;
        }
      } catch (error) {
        pendingPlaceholderIdsRef.current = null;
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
    if (state.state !== 'awaitingPlaceholder' || !state.bufferedContent) return;
    const ids = pendingPlaceholderIdsRef.current;
    if (!ids) return;

    const payload = {
      ids,
      content: state.bufferedContent,
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
  }, [
    agentStatuses,
    elapsedSeconds,
    enhanceLiveMessages,
    pendingApproval,
    setMessages,
    state,
    toolEvents,
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
      patchManagedStreamingStatusMessage<TMessage, TTool, TAgent>(previous, ids.statusMessageId, {
        toolEvents,
      })
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

        const statusToolEvents = finalToolEvents.length > 0 ? finalToolEvents : toolEvents;
        setMessages((previous) =>
          patchManagedStreamingStatusMessage<TMessage, TTool, TAgent>(
            previous,
            ids.statusMessageId,
            {
              elapsedSeconds,
              toolEvents: statusToolEvents,
              agentStatuses,
              pendingApproval,
              requireAgentStatus: true,
            }
          )
        );

        if (cancelled || !isMountedRef.current) return;
        await persistence.persistAgentStatuses?.({
          conversationId: activeConversationId,
          ids,
          elapsedSeconds,
          toolEvents: statusToolEvents,
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
    if (!finalizationTargetKey || isFinalizingRef.current) return;

    if (!finalizationTarget) return;
    const { ids, response, key: finalKey } = finalizationTarget;
    if (handledFinalKeyRef.current === finalKey) return;
    let cancelled = false;
    isFinalizingRef.current = true;
    handledFinalKeyRef.current = finalKey;
    const task: { key: string; cancel: () => void } = {
      key: finalKey,
      cancel: () => {
        cancelled = true;
        if (finalizationTaskRef.current === task) {
          finalizationTaskRef.current = null;
          isFinalizingRef.current = false;
        }
        if (handledFinalKeyRef.current === finalKey) {
          handledFinalKeyRef.current = null;
        }
      },
    };
    finalizationTaskRef.current = task;
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
        if (finalizationTaskRef.current === task) {
          finalizationTaskRef.current = null;
          isFinalizingRef.current = false;
          if (!cancelled && isMountedRef.current && afterFinalState === 'reset') {
            resetStreamingState();
          }
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
    finalizationTarget,
    finalizationTargetKey,
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
    const task: { key: string; cancel: () => void } = {
      key: errorKey,
      cancel: () => {
        cancelled = true;
        if (errorPersistenceTaskRef.current === task) {
          errorPersistenceTaskRef.current = null;
          isPersistingErrorRef.current = false;
        }
        if (handledErrorKeyRef.current === errorKey) {
          handledErrorKeyRef.current = null;
        }
      },
    };
    errorPersistenceTaskRef.current = task;

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
        if (errorPersistenceTaskRef.current === task) {
          errorPersistenceTaskRef.current = null;
          isPersistingErrorRef.current = false;
          if (!cancelled && isMountedRef.current && afterErrorState === 'reset') {
            resetStreamingState();
          }
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
