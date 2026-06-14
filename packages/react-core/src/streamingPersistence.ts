import type { MessagePairIds } from '@taskforceai/shared/streaming/lifecycle-effects';
import {
  extractGeneratedFileToolEvents,
  type StreamingPairPayload,
} from '@taskforceai/shared/streaming/message-updates';
import type { ManagedStreamingPersistence } from './useManagedStreamingMessages';

type AssistantRole = 'assistant';

export type StreamingMessageUpsert<TSource, TTool, TAgent, TApproval = unknown> = {
  conversationId: string;
  messageId: string;
  role: AssistantRole;
  content: string;
  isStreaming: boolean;
  isAgentStatus?: boolean;
  elapsedSeconds?: number;
  error?: string | null;
  sources?: TSource[];
  toolEvents?: TTool[];
  agentStatuses?: TAgent[];
  pendingApproval?: TApproval;
  trace_id?: string;
  createdAt?: number;
  updatedAt?: number;
};

type QueueLiveContent<TSource> = (payload: {
  conversationId: string;
  messageId: string;
  content: string;
  isStreaming: boolean;
  error: null;
  sources: TSource[];
  isAgentStatus: false;
}) => void;

type QueueToolEvents<TTool> = (payload: {
  conversationId: string | null;
  messageId: string;
  toolEvents: TTool[];
}) => void;

export interface CreateStreamingPersistenceOptions<
  TSource,
  TTool,
  TAgent,
  TApproval = unknown,
  TMessage extends { id: string } = { id: string },
> {
  upsertMessage: (
    payload: StreamingMessageUpsert<TSource, TTool, TAgent, TApproval>
  ) => Promise<void>;
  deleteMessage?: (messageId: string, conversationId: string) => Promise<void>;
  setMessages?: React.Dispatch<React.SetStateAction<TMessage[]>>;
  placeholderMeta?: (
    kind: 'status' | 'content'
  ) => Partial<StreamingMessageUpsert<TSource, TTool, TAgent, TApproval>>;
  queueLiveContent?: QueueLiveContent<TSource>;
  queueToolEvents?: QueueToolEvents<TTool>;
  flushBeforeFinalState?: () => Promise<void>;
  flushBeforeErrorState?: () => Promise<void>;
  clearErrorSources?: boolean;
}

const assistantMessage = <TSource, TTool, TAgent, TApproval>(
  conversationId: string,
  messageId: string,
  patch: Partial<StreamingMessageUpsert<TSource, TTool, TAgent, TApproval>>
): StreamingMessageUpsert<TSource, TTool, TAgent, TApproval> => ({
  conversationId,
  messageId,
  role: 'assistant',
  content: '',
  isStreaming: false,
  ...patch,
});

export const createStreamingPersistence = <
  TSource,
  TTool,
  TAgent,
  TApproval = unknown,
  TMessage extends { id: string } = { id: string },
>({
  upsertMessage,
  deleteMessage,
  setMessages,
  placeholderMeta,
  queueLiveContent,
  queueToolEvents,
  flushBeforeFinalState,
  flushBeforeErrorState,
  clearErrorSources = false,
}: CreateStreamingPersistenceOptions<
  TSource,
  TTool,
  TAgent,
  TApproval,
  TMessage
>): ManagedStreamingPersistence<TSource, TTool, TAgent, TApproval> => ({
  persistPlaceholderPair: async (conversationId: string, ids: MessagePairIds) => {
    await Promise.all([
      upsertMessage(
        assistantMessage(conversationId, ids.statusMessageId, {
          isStreaming: true,
          isAgentStatus: true,
          toolEvents: [],
          ...placeholderMeta?.('status'),
        })
      ),
      upsertMessage(
        assistantMessage(conversationId, ids.contentMessageId, {
          isStreaming: true,
          isAgentStatus: false,
          toolEvents: [],
          ...placeholderMeta?.('content'),
        })
      ),
    ]);
  },
  rollbackPlaceholderPair:
    deleteMessage && setMessages
      ? (ids, conversationId) => {
          setMessages((previous) =>
            previous.filter(
              (message) => message.id !== ids.statusMessageId && message.id !== ids.contentMessageId
            )
          );
          if (conversationId) {
            void deleteMessage(ids.statusMessageId, conversationId);
            void deleteMessage(ids.contentMessageId, conversationId);
          }
        }
      : undefined,
  persistLiveContent: ({ conversationId, ids, content }) => {
    if (queueLiveContent) {
      queueLiveContent({
        messageId: ids.contentMessageId,
        conversationId,
        content,
        isStreaming: true,
        error: null,
        sources: [],
        isAgentStatus: false,
      });
      return;
    }
    return upsertMessage(
      assistantMessage(conversationId, ids.contentMessageId, {
        content,
        isStreaming: true,
        isAgentStatus: false,
      })
    );
  },
  persistLiveStatus: ({
    conversationId,
    ids,
    elapsedSeconds,
    toolEvents,
    agentStatuses,
    pendingApproval,
  }) =>
    upsertMessage(
      assistantMessage(conversationId, ids.statusMessageId, {
        isStreaming: true,
        isAgentStatus: true,
        elapsedSeconds,
        toolEvents,
        agentStatuses,
        pendingApproval: pendingApproval ?? undefined,
      })
    ),
  persistToolEvents: queueToolEvents
    ? ({ conversationId, ids, toolEvents }) =>
        queueToolEvents({
          messageId: ids.statusMessageId,
          conversationId,
          toolEvents,
        })
    : undefined,
  persistAgentStatuses: ({
    conversationId,
    ids,
    elapsedSeconds,
    toolEvents,
    agentStatuses,
    pendingApproval,
  }) =>
    upsertMessage(
      assistantMessage(conversationId, ids.statusMessageId, {
        isStreaming: true,
        isAgentStatus: true,
        elapsedSeconds,
        sources: [],
        toolEvents,
        agentStatuses,
        pendingApproval: pendingApproval ?? undefined,
      })
    ),
  flushBeforeFinalState,
  flushBeforeErrorState,
  persistFinalState: async (
    conversationId: string,
    ids: MessagePairIds,
    payload: StreamingPairPayload<TSource, TTool, TAgent>
  ) => {
    const generatedFileToolEvents = extractGeneratedFileToolEvents(payload.toolEvents);
    await Promise.all([
      upsertMessage(
        assistantMessage(conversationId, ids.statusMessageId, {
          isStreaming: false,
          isAgentStatus: true,
          elapsedSeconds: payload.elapsedSeconds,
          sources: payload.sources,
          toolEvents: payload.toolEvents,
          agentStatuses: payload.agentStatuses,
          trace_id: payload.traceId ?? undefined,
        })
      ),
      upsertMessage(
        assistantMessage(conversationId, ids.contentMessageId, {
          content: payload.finalResponse,
          isStreaming: false,
          isAgentStatus: false,
          elapsedSeconds: payload.elapsedSeconds,
          sources: payload.sources,
          toolEvents: generatedFileToolEvents,
          trace_id: payload.traceId ?? undefined,
        })
      ),
    ]);
  },
  persistErrorState: (conversationId: string, messageId: string, message: string) =>
    upsertMessage(
      assistantMessage(conversationId, messageId, {
        content: message,
        isStreaming: false,
        error: message,
        ...(clearErrorSources ? { sources: [] } : {}),
      })
    ),
});
