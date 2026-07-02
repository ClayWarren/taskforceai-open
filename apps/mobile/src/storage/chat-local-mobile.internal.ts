import { type ConversationSummary } from '@taskforceai/contracts/contracts';
import type {
  ConversationStore,
  UpsertMessageParams,
} from '@taskforceai/client-runtime';
import { createPersistentConversationStore } from '@taskforceai/client-runtime';

import { err, ok, type Result } from '@taskforceai/shared/result';
import { dbManager } from './database-manager';
import { sqliteStorage } from './sqlite-adapter';
import { createModuleLogger } from '../logger';
import { createRemoteConversationIngestPlan } from './remote-conversation-ingest';
import type { LocalConversation, LocalMessage } from './chat-local-mobile.types';

const logger = createModuleLogger('ChatLocalMobile');

const logStorageError = (prefix: string, error: unknown) => {
  const cause =
    error && typeof error === 'object' && 'cause' in error
      ? (error as { cause?: unknown }).cause
      : undefined;
  logger.error(prefix, {
    error,
    ...(cause ? { cause } : {}),
  });
};

export type { LocalConversation, LocalMessage };

export const mobileConversationStore: ConversationStore = createPersistentConversationStore({
  adapter: sqliteStorage,
  logger,
});

export async function ensureConversation(conversationId: string, title: string): Promise<void> {
  try {
    await dbManager.ensureOrm();
    await mobileConversationStore.ensureConversation(conversationId, title);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logStorageError(`[chat-local-mobile] Failed to ensure conversation: ${msg}`, error);
    throw error;
  }
}

export async function upsertMessage(params: UpsertMessageParams): Promise<void> {
  try {
    await dbManager.ensureOrm();
    await mobileConversationStore.upsertMessage(params);
  } catch (error) {
    logStorageError('[chat-local-mobile] Failed to upsert message:', error);
    throw error;
  }
}

export async function getConversationMessages(
  conversationId: string,
  limit?: number,
  offset?: number
): Promise<Result<LocalMessage[]>> {
  try {
    await dbManager.ensureOrm();
    const messages = await mobileConversationStore.getConversationMessages(conversationId, limit, offset);
    return ok(messages);
  } catch (error) {
    logStorageError('[chat-local-mobile] Failed to get conversation messages:', error);
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

export async function listConversations(limit = 20): Promise<Result<LocalConversation[]>> {
  try {
    await dbManager.ensureOrm();
    return ok(await mobileConversationStore.listConversations(limit));
  } catch (error) {
    logStorageError('[chat-local-mobile] Failed to list conversations:', error);
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

export async function listArchivedConversations(limit = 100): Promise<Result<LocalConversation[]>> {
  try {
    await dbManager.ensureOrm();
    return ok(await mobileConversationStore.listArchivedConversations!(limit));
  } catch (error) {
    logStorageError('[chat-local-mobile] Failed to list archived conversations:', error);
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

export async function archiveConversation(conversationId: string): Promise<void> {
  try {
    await dbManager.ensureOrm();
    await mobileConversationStore.archiveConversation!(conversationId);
  } catch (error) {
    logStorageError('[chat-local-mobile] Failed to archive conversation:', error);
    throw error;
  }
}

export async function restoreConversation(conversationId: string): Promise<void> {
  try {
    await dbManager.ensureOrm();
    await mobileConversationStore.restoreConversation!(conversationId);
  } catch (error) {
    logStorageError('[chat-local-mobile] Failed to restore conversation:', error);
    throw error;
  }
}

export async function archiveAllConversations(): Promise<void> {
  try {
    await dbManager.ensureOrm();
    await mobileConversationStore.archiveAllConversations!();
  } catch (error) {
    logStorageError('[chat-local-mobile] Failed to archive all conversations:', error);
    throw error;
  }
}

export async function deleteAllConversations(): Promise<void> {
  try {
    await dbManager.ensureOrm();
    await sqliteStorage.clearChatData();
  } catch (error) {
    logStorageError('[chat-local-mobile] Failed to delete all conversations:', error);
    throw error;
  }
}

export async function clearConversation(conversationId: string): Promise<void> {
  try {
    await dbManager.ensureOrm();
    await mobileConversationStore.clearConversation(conversationId);
  } catch (error) {
    logStorageError('[chat-local-mobile] Failed to clear conversation:', error);
    throw error;
  }
}

export async function ingestRemoteConversationSummary(summary: ConversationSummary): Promise<void> {
  try {
    const remoteConversationId = `remote-${summary.id}`;
    await ensureConversation(remoteConversationId, summary.user_input ?? 'Remote Conversation');

    const existingMessagesResult = await getConversationMessages(remoteConversationId);
    const existingMessages = existingMessagesResult.ok ? existingMessagesResult.value : [];
    const ingestPlan = createRemoteConversationIngestPlan(summary, existingMessages);

    await upsertMessage(ingestPlan.userMessage);
    await upsertMessage(ingestPlan.agentStatusMessage);
    await upsertMessage(ingestPlan.assistantMessage);
  } catch (error) {
    logStorageError('[chat-local-mobile] Failed to ingest remote conversation summary:', error);
    throw error;
  }
}

export async function deleteMessage(messageId: string, _conversationId: string): Promise<void> {
  try {
    await dbManager.ensureOrm();
    await sqliteStorage.deleteMessage(messageId);
  } catch (error) {
    logStorageError('[chat-local-mobile] Failed to delete message:', error);
    throw error;
  }
}
