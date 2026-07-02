import { createStreamingPersistence, useManagedStreamingMessages } from '@taskforceai/react-core';
import { useCallback, useMemo, useRef } from 'react';

import type { AgentStatus, Message, SourceReference, ToolUsageEvent } from '../types';
import { createModuleLogger } from '../logger';
import {
  createMobileStreamingPlaceholders,
  createMobileStreamingPlaceholderTimes,
} from './streaming-placeholders';

const logger = createModuleLogger('useStreamingMessages');

export interface MessagePersistence {
  upsertMessage: (params: {
    conversationId: string;
    messageId: string;
    role: Message['role'];
    content: string;
    isStreaming: boolean;
    isAgentStatus?: boolean;
    elapsedSeconds?: number;
    error?: string | null;
    sources?: SourceReference[];
    toolEvents?: ToolUsageEvent[];
    agentStatuses?: AgentStatus[];
    createdAt?: number;
    updatedAt?: number;
  }) => Promise<void>;
  deleteMessage: (messageId: string, conversationId: string) => Promise<void>;
}

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
  persistence: MessagePersistence;
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
  persistence,
}: UseStreamingMessagesOptions): StreamingState {
  const placeholderTimesRef = useRef<ReturnType<typeof createMobileStreamingPlaceholderTimes> | null>(
    null
  );

  const getPlaceholderTimes = useCallback(() => {
    placeholderTimesRef.current ??= createMobileStreamingPlaceholderTimes();
    return placeholderTimesRef.current;
  }, []);

  const createPlaceholders = useCallback(
    (ids: { statusMessageId: string; contentMessageId: string }) => {
      placeholderTimesRef.current = createMobileStreamingPlaceholderTimes();
      const { statusPlaceholder, contentPlaceholder } = createMobileStreamingPlaceholders(
        ids,
        placeholderTimesRef.current
      );
      return { statusPlaceholder, contentPlaceholder };
    },
    []
  );

  const managedPersistence = useMemo(
    () =>
      createStreamingPersistence<SourceReference, ToolUsageEvent, AgentStatus, unknown, Message>({
        upsertMessage: persistence.upsertMessage,
        deleteMessage: persistence.deleteMessage,
        setMessages,
        placeholderMeta: (kind) => {
          const placeholderTimes = getPlaceholderTimes();
          const timestamp =
            kind === 'status' ? placeholderTimes.statusTime : placeholderTimes.contentTime;
          return { createdAt: timestamp, updatedAt: timestamp };
        },
      }),
    [getPlaceholderTimes, persistence.deleteMessage, persistence.upsertMessage, setMessages]
  );

  return useManagedStreamingMessages<Message, SourceReference, ToolUsageEvent, AgentStatus>({
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
    persistence: managedPersistence,
    createPlaceholders,
    finalizeFrom: 'state',
    resetWhenIdle: true,
    afterFinalState: 'reset',
    afterErrorState: 'reset',
    logger,
  });
}
