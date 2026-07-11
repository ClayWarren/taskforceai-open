'use client';

import type { MessageRole } from '@taskforceai/client-core/chat/types';
import { type Result, err, ok } from '@taskforceai/client-core/result';
import type { AgentStatus, SourceReference, ToolUsageEvent } from '../types';

import { createChatRepository, type UpsertMessageParams } from '@taskforceai/persistence';
import { logger } from '../logger';
import { tauriStorage } from './tauri-adapter';

export interface LocalConversation {
  conversationId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastMessagePreview: string | null;
  syncVersion: number;
  lastSyncedAt: number;
  deviceId?: string;
  isDeleted: boolean;
  isArchived?: boolean;
}

export interface LocalMessage {
  messageId: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  isStreaming: boolean;
  isAgentStatus?: boolean;
  isLocalCommandOutput?: boolean;
  elapsedSeconds?: number;
  createdAt: number;
  updatedAt: number;
  error?: string | null;
  sources?: SourceReference[];
  toolEvents?: ToolUsageEvent[];
  agentStatuses?: AgentStatus[];
  syncVersion: number;
  lastSyncedAt: number;
  deviceId?: string;
  isDeleted: boolean;
}

export interface PendingPrompt {
  id?: number;
  conversationId: string;
  prompt: string;
  createdAt: number;
  status: 'queued' | 'pending' | 'failed';
}

const repository = createChatRepository(tauriStorage);

export async function ensureConversation(conversationId: string, title: string): Promise<void> {
  try {
    await repository.ensureConversation(conversationId, title);
  } catch (error) {
    logger.error('[chat-local-tauri] ensureConversation failed', error);
  }
}

export async function renameConversation(conversationId: string, title: string): Promise<void> {
  try {
    await repository.renameConversation(conversationId, title);
  } catch (error) {
    logger.error('[chat-local-tauri] renameConversation failed', error);
  }
}

export async function archiveConversation(conversationId: string): Promise<void> {
  try {
    await repository.archiveConversation(conversationId);
  } catch (error) {
    logger.error('[chat-local-tauri] archiveConversation failed', error);
  }
}

export async function restoreConversation(conversationId: string): Promise<void> {
  try {
    await repository.restoreConversation(conversationId);
  } catch (error) {
    logger.error('[chat-local-tauri] restoreConversation failed', error);
  }
}

export async function getConversation(
  conversationId: string
): Promise<Result<LocalConversation, { kind: 'not_found' | 'storage'; message: string }>> {
  try {
    const conversation = await repository.getConversation(conversationId);
    return conversation.ok ? ok(conversation.value) : err(conversation.error);
  } catch (error) {
    logger.error('[chat-local-tauri] getConversation failed', error);
    return err({ kind: 'storage', message: 'Failed to load conversation' });
  }
}

export async function upsertMessage(params: UpsertMessageParams): Promise<void> {
  try {
    await repository.upsertMessage(params);
  } catch (error) {
    logger.error('[chat-local-tauri] upsertMessage failed', error);
  }
}

export async function getConversationMessages(conversationId: string): Promise<LocalMessage[]> {
  try {
    const messages = await repository.getConversationMessages(conversationId);
    return messages;
  } catch (error) {
    logger.error('[chat-local-tauri] getConversationMessages failed', error);
    return [];
  }
}

export async function listConversations(limit = 20): Promise<LocalConversation[]> {
  try {
    const conversations = await repository.listConversations(limit);
    return conversations;
  } catch (error) {
    logger.error('[chat-local-tauri] listConversations failed', error);
    return [];
  }
}

export async function listArchivedConversations(limit = 100): Promise<LocalConversation[]> {
  try {
    const conversations = await repository.listArchivedConversations(limit);
    return conversations;
  } catch (error) {
    logger.error('[chat-local-tauri] listArchivedConversations failed', error);
    return [];
  }
}

export async function clearConversation(conversationId: string): Promise<void> {
  try {
    await repository.clearConversation(conversationId);
  } catch (error) {
    logger.error('[chat-local-tauri] clearConversation failed', error);
  }
}

export async function archiveAllConversations(): Promise<void> {
  try {
    await repository.archiveAllConversations();
  } catch (error) {
    logger.error('[chat-local-tauri] archiveAllConversations failed', error);
  }
}

export async function deleteAllConversations(): Promise<void> {
  try {
    await repository.deleteAllConversations();
  } catch (error) {
    logger.error('[chat-local-tauri] deleteAllConversations failed', error);
  }
}

export async function getLatestConversation(): Promise<
  Result<
    {
      conversation: LocalConversation;
      messages: LocalMessage[];
    },
    { kind: 'not_found' | 'storage'; message: string }
  >
> {
  const conversations = await listConversations(1);
  if (conversations.length === 0 || !conversations[0]) {
    return err({ kind: 'not_found', message: 'No conversations found' });
  }
  const conversation = conversations[0];
  const messages = await getConversationMessages(conversation.conversationId);
  return ok({ conversation, messages });
}

export async function enqueuePrompt(conversationId: string, prompt: string): Promise<void> {
  await repository.enqueuePrompt(conversationId, prompt);
}

export async function updatePromptStatus(
  id: number,
  status: PendingPrompt['status']
): Promise<void> {
  await repository.updatePromptStatus(id, status);
}

export async function removePrompt(id: number): Promise<void> {
  await repository.removePrompt(id);
}

export async function listPendingPrompts(): Promise<PendingPrompt[]> {
  const prompts = await repository.listPendingPrompts();
  return prompts;
}
