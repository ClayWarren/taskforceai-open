import { err, ok } from '@taskforceai/client-core/result';
import { sortedCopy } from '@taskforceai/client-core';

import type {
  ConversationRecord,
  ConversationStore,
  ConversationStoreEvent,
  ConversationStoreSubscriber,
  MessageRecord,
  PendingPromptRecord,
  StreamingRuntime,
  StreamingRuntimeHandlers,
  UpsertMessageParams,
} from '../platform-interfaces';

export const createMockConversationStore = (
  overrides: Partial<ConversationStore> = {}
): ConversationStore => {
  const conversations = new Map<string, ConversationRecord>();
  const messages = new Map<string, MessageRecord[]>();
  const pendingPrompts: PendingPromptRecord[] = [];
  const subscribers = new Set<ConversationStoreSubscriber>();

  const emit = (event: ConversationStoreEvent) => {
    for (const subscriber of subscribers) {
      subscriber(event);
    }
  };

  const store: ConversationStore = {
    async ensureConversation(conversationId, title) {
      const existing = conversations.get(conversationId);
      const now = Date.now();
      if (existing) {
        conversations.set(conversationId, {
          ...existing,
          title: existing.title && existing.title !== 'New Conversation' ? existing.title : title,
          updatedAt: now,
        });
      } else {
        conversations.set(conversationId, {
          conversationId,
          title,
          createdAt: now,
          updatedAt: now,
          lastMessagePreview: null,
        });
      }
      emit({ type: 'conversations-changed', conversationId });
    },
    async renameConversation(conversationId, title) {
      const existing = conversations.get(conversationId);
      if (!existing) {
        return;
      }
      conversations.set(conversationId, { ...existing, title, updatedAt: Date.now() });
      emit({ type: 'conversations-changed', conversationId });
    },
    async getConversation(conversationId) {
      const conversation = conversations.get(conversationId);
      return conversation
        ? ok(conversation)
        : err({ kind: 'not_found' as const, message: 'Conversation not found' });
    },
    async getConversationMessages(conversationId) {
      return messages.get(conversationId) ?? [];
    },
    async upsertMessage(payload: UpsertMessageParams) {
      const existing = messages.get(payload.conversationId) ?? [];
      const idx = existing.findIndex((msg) => msg.messageId === payload.messageId);
      const now = Date.now();
      const existingMessage = idx >= 0 ? existing[idx] : null;
      const message: MessageRecord = {
        messageId: payload.messageId,
        conversationId: payload.conversationId,
        role: payload.role,
        content: payload.content,
        isStreaming: payload.isStreaming,
        createdAt: existingMessage?.createdAt ?? now,
        updatedAt: now,
      };
      if (payload.isAgentStatus !== undefined) {
        message.isAgentStatus = payload.isAgentStatus;
      }
      if (payload.elapsedSeconds !== undefined) {
        message.elapsedSeconds = payload.elapsedSeconds;
      }
      if (payload.error !== undefined) {
        message.error = payload.error;
      }
      message.sources = payload.sources ?? existingMessage?.sources ?? [];
      message.toolEvents = payload.toolEvents ?? existingMessage?.toolEvents ?? [];
      message.agentStatuses = payload.agentStatuses ?? existingMessage?.agentStatuses ?? [];
      if (idx >= 0) {
        existing[idx] = { ...existing[idx], ...message };
      } else {
        existing.push(message);
      }
      messages.set(payload.conversationId, existing);
      const conversation = conversations.get(payload.conversationId);
      if (conversation) {
        conversations.set(payload.conversationId, {
          ...conversation,
          lastMessagePreview:
            payload.role !== 'system'
              ? payload.content.slice(0, 120)
              : conversation.lastMessagePreview,
          updatedAt: Date.now(),
        });
      }
      emit({ type: 'messages-changed', conversationId: payload.conversationId });
      emit({ type: 'conversations-changed', conversationId: payload.conversationId });
    },
    async listConversations() {
      return sortedCopy(Array.from(conversations.values()), (a, b) => b.updatedAt - a.updatedAt);
    },
    async clearConversation(conversationId) {
      conversations.delete(conversationId);
      messages.delete(conversationId);
      emit({ type: 'conversations-changed', conversationId });
      emit({ type: 'messages-changed', conversationId });
    },
    async enqueuePrompt(conversationId, prompt, runPayload) {
      pendingPrompts.push({
        id: pendingPrompts.length + 1,
        conversationId,
        prompt,
        createdAt: Date.now(),
        status: 'queued',
        ...(runPayload ? { runPayload } : {}),
      });
      emit({ type: 'pending-prompts-changed', conversationId });
    },
    async updatePromptStatus(id, status) {
      const prompt = pendingPrompts.find((item) => item.id === id);
      if (prompt) {
        prompt.status = status;
        emit({ type: 'pending-prompts-changed' });
      }
    },
    async removePrompt(id) {
      const index = pendingPrompts.findIndex((item) => item.id === id);
      if (index >= 0) {
        pendingPrompts.splice(index, 1);
        emit({ type: 'pending-prompts-changed' });
      }
    },
    async listPendingPrompts() {
      return [...pendingPrompts];
    },
    subscribe(listener: ConversationStoreSubscriber) {
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
      };
    },
  };

  return { ...store, ...overrides };
};

export interface MockStreamingRuntime extends StreamingRuntime {
  emitOpen: () => void;
  emitMessage: (payload: string) => void;
  emitError: (error: unknown) => void;
  startCallCount: number;
  stopCallCount: number;
}

export const createMockStreamingRuntime = (): MockStreamingRuntime => {
  let handlers: StreamingRuntimeHandlers | null = null;
  let startCallCount = 0;
  let stopCallCount = 0;

  return {
    async startStreaming(_taskId: string, nextHandlers: StreamingRuntimeHandlers) {
      startCallCount += 1;
      handlers = nextHandlers;
    },
    stopStreaming() {
      stopCallCount += 1;
      handlers = null;
    },
    emitOpen() {
      handlers?.onOpen?.();
    },
    emitMessage(payload: string) {
      handlers?.onMessage?.(payload);
    },
    emitError(error: unknown) {
      handlers?.onError?.(error);
    },
    get startCallCount() {
      return startCallCount;
    },
    get stopCallCount() {
      return stopCallCount;
    },
  };
};
