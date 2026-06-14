import { localSearch } from '@taskforceai/shared';
import { getRuntimeEnv } from '@taskforceai/shared/config/app-env';
import { createStreamingPersistence, useManagedStreamingMessages } from '@taskforceai/react-core';
import { extractSourcesFromText, mergeSources } from '@taskforceai/shared/utils/source-extraction';
import { useCallback, useEffect, useMemo } from 'react';

import { logger } from '../logger';
import type {
  AgentStatus,
  Message,
  PendingApproval,
  SourceReference,
  ToolUsageEvent,
} from '../types';
import { createWebStreamingPlaceholders } from './streaming-placeholders';
import { useStreamingPersistenceQueues } from './useStreamingPersistenceQueues';

const STREAMING_DEBUG =
  typeof process !== 'undefined' && getRuntimeEnv('VITE_STREAMING_DEBUG') === '1';

interface UseStreamingMessagesOptions {
  isStreaming: boolean;
  streamContent: string;
  finalResponse: string | null;
  errorMessage: string | null;
  conversationId: string | null;
  ensureActiveConversation: () => Promise<string>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  sources: SourceReference[];
  finalSources: SourceReference[];
  toolEvents: ToolUsageEvent[];
  finalToolEvents: ToolUsageEvent[];
  elapsedSeconds: number;
  agentStatuses: AgentStatus[];
  trace_id: string | null;
  pendingApproval: PendingApproval | null;
}

export interface StreamingState {
  streamingMessageId: string | null;
  resetStreamingState: () => void;
}

export function useStreamingMessages({
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
  trace_id,
  pendingApproval,
}: UseStreamingMessagesOptions): StreamingState {
  const {
    conversationStore,
    appendQueuedContentWrite,
    appendQueuedToolEventsWrite,
    flushPendingDbWritesImmediately,
    flushPendingToolEventsWritesImmediately,
    disposeStreamingPersistenceQueues,
  } = useStreamingPersistenceQueues({
    ensureActiveConversation,
  });

  const createPlaceholders = useCallback(
    (ids: { statusMessageId: string; contentMessageId: string }) => {
      const { statusPlaceholder, responsePlaceholder } = createWebStreamingPlaceholders(ids);
      return { statusPlaceholder, contentPlaceholder: responsePlaceholder };
    },
    []
  );

  const persistence = useMemo(
    () =>
      createStreamingPersistence<SourceReference, ToolUsageEvent, AgentStatus, PendingApproval>({
        upsertMessage: (...args) => conversationStore.upsertMessage(...args),
        queueLiveContent: appendQueuedContentWrite,
        queueToolEvents: appendQueuedToolEventsWrite,
        flushBeforeFinalState: async () => {
          await flushPendingDbWritesImmediately();
          await flushPendingToolEventsWritesImmediately();
        },
        flushBeforeErrorState: async () => {
          await flushPendingDbWritesImmediately();
          await flushPendingToolEventsWritesImmediately();
        },
        clearErrorSources: true,
      }),
    [
      appendQueuedContentWrite,
      appendQueuedToolEventsWrite,
      conversationStore,
      flushPendingDbWritesImmediately,
      flushPendingToolEventsWritesImmediately,
    ]
  );

  const resolveFinalSources = useCallback(
    ({
      finalResponse: completedResponse,
      sources: liveSources,
      finalSources: completedSources,
      toolEvents: liveToolEvents,
      finalToolEvents: completedToolEvents,
    }: {
      finalResponse: string;
      sources: SourceReference[];
      finalSources: SourceReference[];
      toolEvents: ToolUsageEvent[];
      finalToolEvents: ToolUsageEvent[];
    }) => {
      const baseSources = completedSources.length > 0 ? completedSources : liveSources;
      const toolSources = (
        completedToolEvents.length > 0 ? completedToolEvents : liveToolEvents
      ).flatMap((event) => event.sources ?? []);
      return mergeSources(
        mergeSources(baseSources, toolSources),
        extractSourcesFromText(completedResponse)
      );
    },
    []
  );

  const result = useManagedStreamingMessages<
    Message,
    SourceReference,
    ToolUsageEvent,
    AgentStatus,
    PendingApproval
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
    pendingApproval,
    traceId: trace_id,
    finalizeFrom: 'prop',
    clearSourcesOnError: true,
    createPlaceholders,
    persistence,
    resolveFinalSources,
    logger,
    debug: STREAMING_DEBUG,
    afterFinalState: 'dispatch-final',
    afterErrorState: 'dispatch-error',
    onFinalized: async ({
      conversationId: activeConversationId,
      ids,
      finalResponse: finalizedResponse,
    }) => {
      localSearch.addItem({
        id: ids.contentMessageId,
        title: 'Assistant response',
        content: finalizedResponse,
        tags: [activeConversationId, 'assistant'],
      });
    },
    onErrorPersisted: async ({
      conversationId: activeConversationId,
      contentMessageId,
      message,
    }) => {
      localSearch.removeItem(contentMessageId);
      localSearch.addItem({
        id: contentMessageId,
        title: 'Assistant error',
        content: message,
        tags: [activeConversationId, 'assistant', 'error'],
      });
    },
  });

  useEffect(() => disposeStreamingPersistenceQueues, [disposeStreamingPersistenceQueues]);

  return result;
}
