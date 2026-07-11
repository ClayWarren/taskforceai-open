import type { MessagePairIds } from '@taskforceai/client-core/streaming/lifecycle-effects';

export interface StreamingMessageLike<TSource = unknown, TTool = unknown, TAgent = unknown> {
  id: string;
  role?: unknown;
  content: string;
  isStreaming?: boolean;
  isAgentStatus?: boolean;
  elapsedSeconds?: number;
  error?: string | null;
  sources?: TSource[];
  toolEvents?: TTool[];
  agentStatuses?: TAgent[];
  trace_id?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface StreamingPairPayload<TSource = unknown, TTool = unknown, TAgent = unknown> {
  finalResponse: string;
  sources: TSource[];
  toolEvents: TTool[];
  elapsedSeconds: number;
  agentStatuses: TAgent[];
  updatedAt?: number;
  traceId?: string | null;
}

const hasGeneratedFileArtifact = (event: unknown): boolean =>
  typeof event === 'object' &&
  event !== null &&
  'generatedFile' in event &&
  Boolean((event as { generatedFile?: unknown }).generatedFile);

export const extractGeneratedFileToolEvents = <TTool>(toolEvents: TTool[]): TTool[] =>
  toolEvents.filter(hasGeneratedFileArtifact);

export const updateStreamingContentAndStatusMessages = <
  TMessage extends StreamingMessageLike<TSource, TTool, TAgent>,
  TSource = unknown,
  TTool = unknown,
  TAgent = unknown,
>(
  previous: TMessage[],
  {
    ids,
    content,
    agentStatuses,
    elapsedSeconds,
    toolEvents,
    timestamp,
  }: {
    ids: MessagePairIds;
    content: string;
    agentStatuses: TAgent[];
    elapsedSeconds: number;
    toolEvents: TTool[];
    timestamp?: number;
  }
): TMessage[] => {
  let foundContent = false;
  let foundStatus = false;
  const nextUpdatedAt = timestamp ?? Date.now();

  const next = previous.map((message) => {
    if (message.id === ids.contentMessageId) {
      foundContent = true;
      return {
        ...message,
        content,
        isStreaming: true,
        updatedAt: nextUpdatedAt,
      };
    }

    if (message.id === ids.statusMessageId) {
      foundStatus = true;
      return {
        ...message,
        agentStatuses,
        elapsedSeconds,
        toolEvents,
        updatedAt: nextUpdatedAt,
      };
    }

    return message;
  });

  let changed = foundContent || foundStatus;

  if (!foundStatus) {
    next.push({
      id: ids.statusMessageId,
      role: 'assistant',
      content: '',
      isStreaming: true,
      isAgentStatus: true,
      toolEvents,
      agentStatuses,
      elapsedSeconds,
      createdAt: nextUpdatedAt,
      updatedAt: nextUpdatedAt,
      sources: [],
    } as unknown as TMessage);
    changed = true;
  }

  if (!foundContent) {
    next.push({
      id: ids.contentMessageId,
      role: 'assistant',
      content,
      isStreaming: true,
      isAgentStatus: false,
      toolEvents: [],
      createdAt: nextUpdatedAt,
      updatedAt: nextUpdatedAt,
      sources: [],
    } as unknown as TMessage);
    changed = true;
  }

  return changed ? next : previous;
};

export const finalizeStreamingMessages = <
  TMessage extends StreamingMessageLike<TSource, TTool, TAgent>,
  TSource = unknown,
  TTool = unknown,
  TAgent = unknown,
>(
  previous: TMessage[],
  ids: MessagePairIds,
  payload: StreamingPairPayload<TSource, TTool, TAgent>
): TMessage[] => {
  let foundContent = false;
  let foundStatus = false;

  const next = previous.map((message) => {
    if (message.id === ids.statusMessageId) {
      foundStatus = true;
      return {
        ...message,
        isStreaming: false,
        elapsedSeconds: payload.elapsedSeconds,
        toolEvents: payload.toolEvents,
        agentStatuses: payload.agentStatuses,
        ...(payload.traceId !== undefined ? { trace_id: payload.traceId ?? undefined } : {}),
        ...(payload.updatedAt !== undefined ? { updatedAt: payload.updatedAt } : {}),
      };
    }

    if (message.id === ids.contentMessageId) {
      foundContent = true;
      const generatedFileToolEvents = extractGeneratedFileToolEvents(payload.toolEvents);
      return {
        ...message,
        content: payload.finalResponse,
        isStreaming: false,
        sources: payload.sources,
        toolEvents: generatedFileToolEvents,
        elapsedSeconds: payload.elapsedSeconds,
        ...(payload.traceId !== undefined ? { trace_id: payload.traceId ?? undefined } : {}),
        ...(payload.updatedAt !== undefined ? { updatedAt: payload.updatedAt } : {}),
      };
    }

    return message;
  });

  return foundStatus || foundContent ? next : previous;
};

export const applyStreamingErrorMessage = <TMessage extends StreamingMessageLike>(
  previous: TMessage[],
  contentMessageId: string,
  message: string,
  options: { clearSources?: boolean } = {}
): TMessage[] => {
  const next = [...previous];

  for (let index = next.length - 1; index >= 0; index -= 1) {
    const existingMessage = next[index];
    if (existingMessage?.id !== contentMessageId) {
      continue;
    }

    next[index] = {
      ...existingMessage,
      content: message,
      isStreaming: false,
      error: message,
      ...(options.clearSources ? { sources: [] } : {}),
    };
    return next;
  }

  return previous;
};
