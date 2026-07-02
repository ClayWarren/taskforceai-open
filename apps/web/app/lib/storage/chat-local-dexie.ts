'use client';

import { type Result, err, ok } from '@taskforceai/shared/result';
import { definedProps } from '@taskforceai/shared/utils/object';
import {
  type LocalConversation,
  type LocalMessage,
  type PendingPrompt,
  ensureDexieReady,
} from '@taskforceai/web/lib/dexie-db';

import {
  createChatRepository,
  type RepositoryConversation,
  type UpsertMessageParams,
} from '@taskforceai/persistence';
import { DexieStorageAdapter } from './dexie-adapter';

// Re-export types for convenience
export type { PendingPrompt, LocalMessage, LocalConversation };

let _repository: ReturnType<typeof createChatRepository> | null = null;
function getRepository() {
  if (!_repository) {
    _repository = createChatRepository(new DexieStorageAdapter());
  }
  return _repository;
}

const mapToLocalConversation = (record: RepositoryConversation): LocalConversation => ({
  conversationId: record.conversationId,
  title: record.title,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  lastMessagePreview: record.lastMessagePreview,
  syncVersion: record.syncVersion,
  lastSyncedAt: record.lastSyncedAt,
  ...definedProps({ deviceId: record.deviceId }),
  isDeleted: record.isDeleted,
  isArchived: record.isArchived === true,
});

export async function ensureConversation(conversationId: string, title: string): Promise<void> {
  if (!(await ensureDexieReady())) {
    return;
  }
  await getRepository().ensureConversation(conversationId, title);
}

export async function renameConversation(conversationId: string, title: string): Promise<void> {
  if (!(await ensureDexieReady())) {
    return;
  }
  await getRepository().renameConversation(conversationId, title);
}

export async function archiveConversation(conversationId: string): Promise<void> {
  if (!(await ensureDexieReady())) {
    return;
  }
  await getRepository().archiveConversation(conversationId);
}

export async function restoreConversation(conversationId: string): Promise<void> {
  if (!(await ensureDexieReady())) {
    return;
  }
  await getRepository().restoreConversation(conversationId);
}

export async function getConversation(
  conversationId: string
): Promise<Result<LocalConversation, { kind: 'not_found' | 'storage'; message: string }>> {
  if (!(await ensureDexieReady())) {
    return err({ kind: 'storage', message: 'Dexie not ready' });
  }
  const result = await getRepository().getConversation(conversationId);
  if (!result.ok) return err(result.error);
  return ok(mapToLocalConversation(result.value));
}

export async function upsertMessage(params: UpsertMessageParams): Promise<void> {
  if (!(await ensureDexieReady())) {
    return;
  }
  await getRepository().upsertMessage(params);
}

export async function getConversationMessages(conversationId: string): Promise<LocalMessage[]> {
  if (!(await ensureDexieReady())) {
    return [];
  }
  const messages = await getRepository().getConversationMessages(conversationId);
  return messages as LocalMessage[];
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
  if (!(await ensureDexieReady())) {
    return err({ kind: 'storage', message: 'Dexie not ready' });
  }
  const conversations = await getRepository().listConversations(1);
  if (!conversations.length || !conversations[0]) {
    return err({ kind: 'not_found', message: 'No conversations found' });
  }
  const conversation = conversations[0];
  const messages = await getConversationMessages(conversation.conversationId);
  return ok({
    conversation: mapToLocalConversation(conversation),
    messages,
  });
}

export async function listConversations(limit = 20): Promise<LocalConversation[]> {
  if (!(await ensureDexieReady())) {
    return [];
  }
  const conversations = await getRepository().listConversations(limit);
  return conversations.map(mapToLocalConversation);
}

export async function listArchivedConversations(limit = 100): Promise<LocalConversation[]> {
  if (!(await ensureDexieReady())) {
    return [];
  }
  const conversations = await getRepository().listArchivedConversations(limit);
  return conversations.map(mapToLocalConversation);
}

export async function clearConversation(conversationId: string): Promise<void> {
  if (!(await ensureDexieReady())) {
    return;
  }
  await getRepository().clearConversation(conversationId);
}

export async function archiveAllConversations(): Promise<void> {
  if (!(await ensureDexieReady())) {
    return;
  }
  await getRepository().archiveAllConversations();
}

export async function deleteAllConversations(): Promise<void> {
  if (!(await ensureDexieReady())) {
    return;
  }
  await getRepository().deleteAllConversations();
}

export async function enqueuePrompt(conversationId: string, prompt: string): Promise<void> {
  if (!(await ensureDexieReady())) {
    return;
  }
  await getRepository().enqueuePrompt(conversationId, prompt);
}

export async function updatePromptStatus(
  id: number,
  status: PendingPrompt['status']
): Promise<void> {
  if (!(await ensureDexieReady())) {
    return;
  }
  await getRepository().updatePromptStatus(id, status);
}

export async function removePrompt(id: number): Promise<void> {
  if (!(await ensureDexieReady())) {
    return;
  }
  await getRepository().removePrompt(id);
}

export async function listPendingPrompts(): Promise<PendingPrompt[]> {
  if (!(await ensureDexieReady())) {
    return [];
  }
  const prompts = await getRepository().listPendingPrompts();
  return prompts as PendingPrompt[];
}
