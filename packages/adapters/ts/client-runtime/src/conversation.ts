import type { ConversationSummary } from '@taskforceai/contracts/contracts';
import type { Message } from '@taskforceai/client-core/chat/types';
import { normalizeToolUsageEvent } from '@taskforceai/client-core/streaming/normalization';
import { createId } from './id';
import { definedProps } from '@taskforceai/client-core/utils/object';

import { localSearch } from './local-search';
import type { ConversationStore, KeyValueStorage, MessageRecord } from './types';

export const DEFAULT_MESSAGES_PAGE_SIZE = 50;

export interface ConversationSnapshot {
  conversationId: string;
  messages: Message[];
  hasMoreMessages: boolean;
}

export interface LoadedConversationSnapshot extends ConversationSnapshot {
  hasMoreMessages: boolean;
  isPublic: boolean;
  shareId: string | null;
}

const hydrateMessageRecord = (record: MessageRecord): Message => {
  const message: Message = {
    id: record.messageId,
    content: record.content,
    role: record.role,
    sources: record.sources ?? [],
    toolEvents: record.toolEvents ?? [],
    agentStatuses: record.agentStatuses ?? [],
  };

  if (record.isStreaming !== undefined) message.isStreaming = record.isStreaming;
  if (record.isAgentStatus !== undefined) message.isAgentStatus = record.isAgentStatus;
  if (record.isLocalCommandOutput !== undefined) {
    message.isLocalCommandOutput = record.isLocalCommandOutput;
  }
  if (record.elapsedSeconds !== undefined) message.elapsedSeconds = record.elapsedSeconds;
  if (record.createdAt !== undefined) message.createdAt = record.createdAt;
  if (record.updatedAt !== undefined) message.updatedAt = record.updatedAt;
  if (record.trace_id !== undefined) message.trace_id = record.trace_id;

  return message;
};

export const hydrateMessageRecords = (records: MessageRecord[]): Message[] =>
  records.map(hydrateMessageRecord);

export const resolveConversationStorageId = (conversation: ConversationSummary): string =>
  conversation.id > 0
    ? `remote-${conversation.id}`
    : conversation.model || `local-${Math.abs(conversation.id)}`;

const normalizeConversationSources = (
  sources: ConversationSummary['sources']
): Message['sources'] | undefined => {
  if (!Array.isArray(sources) || sources.length === 0) {
    return undefined;
  }

  return sources.map((source) => ({
    url: source.url,
    ...definedProps({
      title: source.title,
      snippet: source.snippet,
    }),
  }));
};

const normalizeConversationAgentStatuses = (
  statuses: ConversationSummary['agentStatuses']
): Message['agentStatuses'] | undefined => {
  if (!Array.isArray(statuses) || statuses.length === 0) {
    return undefined;
  }

  return statuses.map((status) => ({
    status: status.status,
    ...definedProps({
      agent_id: status.agent_id,
      progress: status.progress,
      result: status.result,
      reasoning: status.reasoning,
      model: status.model,
    }),
  }));
};

type MessageToolEvent = NonNullable<Message['toolEvents']>[number];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readString = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

const readNumber = (record: Record<string, unknown>, key: string): number | undefined => {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

const normalizeConversationGeneratedFile = (
  value: unknown
): MessageToolEvent['generatedFile'] | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const filename = readString(value, 'filename');
  if (!filename) {
    return undefined;
  }

  return {
    filename,
    ...definedProps({
      artifactId: readString(value, 'artifactId') ?? readString(value, 'artifact_id'),
      filepath: readString(value, 'filepath'),
      mimeType: readString(value, 'mimeType') ?? readString(value, 'mime_type'),
      bytes: readNumber(value, 'bytes'),
      fileId: readString(value, 'fileId') ?? readString(value, 'file_id'),
      downloadUrl: readString(value, 'downloadUrl') ?? readString(value, 'download_url'),
    }),
  };
};

const normalizeConversationToolEvents = (
  toolEvents: ConversationSummary['toolEvents'],
  fallbackTimestamp: string
): Message['toolEvents'] | undefined =>
  Array.isArray(toolEvents) && toolEvents.length > 0
    ? toolEvents.map((event) => {
        const eventRecord = event as Record<string, unknown>;
        return normalizeToolUsageEvent(
          {
            agentLabel: event.agentLabel,
            toolName: event.toolName,
            arguments: event.arguments,
            success: event.success,
            durationMs: event.durationMs,
            ...definedProps({
              invocationId: event.invocationId,
              timestamp: event.timestamp,
              agentId: event.agentId,
              status: readString(eventRecord, 'status'),
              resultPreview: event.resultPreview,
              error: event.error,
              image_base64: readString(eventRecord, 'image_base64'),
              sources: normalizeConversationSources(event.sources),
              generatedFile: normalizeConversationGeneratedFile(event.generatedFile),
            }),
          },
          fallbackTimestamp
        );
      })
    : undefined;

const firstDefined = <T>(...values: Array<T | undefined>): T | undefined =>
  values.find((value) => value !== undefined);

const syncConversationProjectId = async (
  conversationStore: ConversationStore,
  conversationId: string,
  projectId: ConversationSummary['projectId']
): Promise<void> => {
  if (
    conversationStore.setConversationProjectId &&
    (projectId === null || typeof projectId === 'number')
  ) {
    await conversationStore.setConversationProjectId(conversationId, projectId);
  }
};

export async function ingestRemoteConversationSummary(options: {
  conversationStore: ConversationStore;
  conversation: ConversationSummary;
}): Promise<string> {
  const { conversationStore, conversation } = options;
  const conversationId = resolveConversationStorageId(conversation);
  const createdAt = new Date(conversation.timestamp).getTime();
  const timestamp = Number.isFinite(createdAt) ? createdAt : Date.now();
  const title = conversation.user_input?.trim().slice(0, 120) || 'Remote Conversation';
  const existingMessages = await conversationStore.getConversationMessages(conversationId);
  const agentStatusMessageId = `${conversationId}-agent-status`;
  const assistantMessageId = `${conversationId}-assistant`;
  const existingAgentStatusMessage = existingMessages.find(
    (message) => message.messageId === agentStatusMessageId
  );
  const existingAssistantMessage = existingMessages.find(
    (message) => message.messageId === assistantMessageId
  );
  const summarySources = normalizeConversationSources(conversation.sources);
  const summaryToolEvents = normalizeConversationToolEvents(
    conversation.toolEvents,
    new Date(timestamp).toISOString()
  );
  const summaryAgentStatuses = normalizeConversationAgentStatuses(conversation.agentStatuses);
  const sharedSources =
    firstDefined(
      summarySources,
      existingAssistantMessage?.sources,
      existingAgentStatusMessage?.sources
    ) ?? [];
  const assistantToolEvents =
    firstDefined(summaryToolEvents, existingAssistantMessage?.toolEvents) ?? [];

  await conversationStore.ensureConversation(conversationId, title);
  await syncConversationProjectId(conversationStore, conversationId, conversation.projectId);
  await conversationStore.upsertMessage({
    conversationId,
    messageId: `${conversationId}-user`,
    role: 'user',
    content: conversation.user_input ?? '',
    isStreaming: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await conversationStore.upsertMessage({
    conversationId,
    messageId: agentStatusMessageId,
    role: 'assistant',
    content: '',
    isStreaming: false,
    isAgentStatus: true,
    sources: sharedSources,
    toolEvents: existingAgentStatusMessage?.toolEvents ?? [],
    agentStatuses:
      firstDefined(summaryAgentStatuses, existingAgentStatusMessage?.agentStatuses) ?? [],
    ...(conversation.execution_time !== undefined && {
      elapsedSeconds: Math.round(conversation.execution_time),
    }),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await conversationStore.upsertMessage({
    conversationId,
    messageId: assistantMessageId,
    role: 'assistant',
    content: conversation.result ?? '',
    isStreaming: false,
    isAgentStatus: false,
    sources: sharedSources,
    toolEvents: assistantToolEvents,
    agentStatuses:
      firstDefined(summaryAgentStatuses, existingAssistantMessage?.agentStatuses) ?? [],
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  return conversationId;
}

export async function restoreConversationSnapshot(options: {
  conversationStore: ConversationStore;
  storage: KeyValueStorage;
  activeConversationKey: string;
  pageSize?: number;
  shouldAbort?: () => boolean;
}): Promise<ConversationSnapshot | null> {
  const { conversationStore, storage, activeConversationKey, shouldAbort } = options;
  const pageSize = options.pageSize ?? DEFAULT_MESSAGES_PAGE_SIZE;
  const savedId = await storage.getItem(activeConversationKey);
  if (shouldAbort?.()) {
    return null;
  }
  if (!savedId) {
    return null;
  }

  const conversationResult = await conversationStore.getConversation(savedId);
  if (shouldAbort?.()) {
    return null;
  }
  if (!conversationResult.ok) {
    if (!shouldAbort?.()) {
      await storage.removeItem(activeConversationKey);
    }
    return null;
  }

  const storedMessages = await conversationStore.getConversationMessages(savedId, pageSize, 0);
  if (shouldAbort?.()) {
    return null;
  }
  return {
    conversationId: savedId,
    messages: hydrateMessageRecords(storedMessages),
    hasMoreMessages: storedMessages.length === pageSize,
  };
}

export async function createConversation(options: {
  conversationStore: ConversationStore;
  storage: KeyValueStorage;
  activeConversationKey: string;
}): Promise<string> {
  const { conversationStore, storage, activeConversationKey } = options;
  const conversationId = createId('local');
  await conversationStore.ensureConversation(conversationId, 'New Conversation');
  await storage.setItem(activeConversationKey, conversationId);
  return conversationId;
}

export async function appendUserMessage(options: {
  conversationStore: ConversationStore;
  conversationId: string;
  content: string;
}): Promise<Message> {
  const { conversationStore, conversationId, content } = options;
  const messageId = createId('user');
  const now = Date.now();
  const userMessage: Message = {
    id: messageId,
    content,
    role: 'user',
    sources: [],
    createdAt: now,
    updatedAt: now,
  };

  const conversationTitle = content.trim().slice(0, 120) || 'New Conversation';
  await conversationStore.ensureConversation(conversationId, conversationTitle);
  await conversationStore.upsertMessage({
    conversationId,
    messageId,
    role: 'user',
    content,
    isStreaming: false,
    createdAt: now,
    updatedAt: now,
  });

  localSearch.addItem({
    id: messageId,
    title: conversationTitle,
    content,
    tags: [conversationId, 'user'],
  });

  return userMessage;
}

export async function loadConversationSnapshot(options: {
  conversationStore: ConversationStore;
  storage?: KeyValueStorage;
  activeConversationKey?: string;
  conversation: ConversationSummary;
  pageSize?: number;
}): Promise<LoadedConversationSnapshot> {
  const { conversationStore, storage, activeConversationKey, conversation } = options;
  const pageSize = options.pageSize ?? DEFAULT_MESSAGES_PAGE_SIZE;
  const conversationId = resolveConversationStorageId(conversation);
  const loadedMessages = await conversationStore.getConversationMessages(
    conversationId,
    pageSize,
    0
  );
  if (storage && activeConversationKey) {
    await storage.setItem(activeConversationKey, conversationId);
  }

  return {
    conversationId,
    messages: hydrateMessageRecords(loadedMessages),
    hasMoreMessages: loadedMessages.length === pageSize,
    isPublic: 'isPublic' in conversation ? Boolean(conversation.isPublic) : false,
    shareId: 'shareId' in conversation ? (conversation.shareId ?? null) : null,
  };
}

export async function loadMoreConversationMessages(options: {
  conversationStore: ConversationStore;
  conversationId: string;
  offset: number;
  pageSize?: number;
}): Promise<{ messages: Message[]; hasMoreMessages: boolean }> {
  const { conversationStore, conversationId, offset } = options;
  const pageSize = options.pageSize ?? DEFAULT_MESSAGES_PAGE_SIZE;
  const moreMessages = await conversationStore.getConversationMessages(
    conversationId,
    pageSize,
    offset
  );

  return {
    messages: hydrateMessageRecords(moreMessages),
    hasMoreMessages: moreMessages.length === pageSize,
  };
}
