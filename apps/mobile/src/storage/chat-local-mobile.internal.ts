import { type ConversationSummary } from '@taskforceai/contracts/contracts';
import type {
  ConversationStore,
  UpsertMessageParams,
} from '@taskforceai/client-runtime';
import { createPersistentConversationStore } from '@taskforceai/client-runtime';

import type { Result } from '@taskforceai/client-core/result';
import { sqliteStorage } from './sqlite-adapter';
import { createModuleLogger } from '../logger';
import { createRemoteConversationIngestPlan } from './remote-conversation-ingest';
import type { LocalConversation, LocalMessage } from './chat-local-mobile.types';
import { createMobileStorageOperations } from './chat-local-mobile-operations';

const logger = createModuleLogger('ChatLocalMobile');
const storage = createMobileStorageOperations(logger);

export type { LocalConversation, LocalMessage };

export const mobileConversationStore: ConversationStore = createPersistentConversationStore({
  adapter: sqliteStorage,
  logger,
});

export async function ensureConversation(conversationId: string, title: string): Promise<void> {
  return storage.run(
    (error) =>
      `[chat-local-mobile] Failed to ensure conversation: ${
        error instanceof Error ? error.message : String(error)
      }`,
    () => mobileConversationStore.ensureConversation(conversationId, title)
  );
}

export async function upsertMessage(params: UpsertMessageParams): Promise<void> {
  return storage.run('[chat-local-mobile] Failed to upsert message:', () =>
    mobileConversationStore.upsertMessage(params)
  );
}

export async function getConversationMessages(
  conversationId: string,
  limit?: number,
  offset?: number
): Promise<Result<LocalMessage[]>> {
  return storage.runResult('[chat-local-mobile] Failed to get conversation messages:', () =>
    mobileConversationStore.getConversationMessages(conversationId, limit, offset)
  );
}

export async function listConversations(limit = 20): Promise<Result<LocalConversation[]>> {
  return storage.runResult('[chat-local-mobile] Failed to list conversations:', () =>
    mobileConversationStore.listConversations(limit)
  );
}

export async function listArchivedConversations(limit = 100): Promise<Result<LocalConversation[]>> {
  return storage.runResult('[chat-local-mobile] Failed to list archived conversations:', () =>
    mobileConversationStore.listArchivedConversations!(limit)
  );
}

export async function archiveConversation(conversationId: string): Promise<void> {
  return storage.run('[chat-local-mobile] Failed to archive conversation:', () =>
    mobileConversationStore.archiveConversation!(conversationId)
  );
}

export async function restoreConversation(conversationId: string): Promise<void> {
  return storage.run('[chat-local-mobile] Failed to restore conversation:', () =>
    mobileConversationStore.restoreConversation!(conversationId)
  );
}

export async function archiveAllConversations(): Promise<void> {
  return storage.run('[chat-local-mobile] Failed to archive all conversations:', () =>
    mobileConversationStore.archiveAllConversations!()
  );
}

export async function deleteAllConversations(): Promise<void> {
  return storage.run('[chat-local-mobile] Failed to delete all conversations:', () =>
    sqliteStorage.clearChatData()
  );
}

export async function clearConversation(conversationId: string): Promise<void> {
  return storage.run('[chat-local-mobile] Failed to clear conversation:', () =>
    mobileConversationStore.clearConversation(conversationId)
  );
}

export async function ingestRemoteConversationSummary(summary: ConversationSummary): Promise<void> {
  return storage.capture(
    '[chat-local-mobile] Failed to ingest remote conversation summary:',
    async () => {
      const remoteConversationId = `remote-${summary.id}`;
      await ensureConversation(remoteConversationId, summary.user_input ?? 'Remote Conversation');

      const existingMessagesResult = await getConversationMessages(remoteConversationId);
      const existingMessages = existingMessagesResult.ok ? existingMessagesResult.value : [];
      const ingestPlan = createRemoteConversationIngestPlan(summary, existingMessages);

      await upsertMessage(ingestPlan.userMessage);
      await upsertMessage(ingestPlan.agentStatusMessage);
      await upsertMessage(ingestPlan.assistantMessage);
    }
  );
}

export async function deleteMessage(messageId: string, _conversationId: string): Promise<void> {
  return storage.run('[chat-local-mobile] Failed to delete message:', () =>
    sqliteStorage.deleteMessage(messageId)
  );
}
