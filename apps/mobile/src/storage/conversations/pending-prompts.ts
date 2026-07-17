import { runRequestSchema } from '@taskforceai/contracts/contracts';
import type { PendingPromptRecord } from '@taskforceai/client-runtime';
import {
  createQueuedRunPayload,
  extractQueuedRunPayloadMetadata,
} from '@taskforceai/client-runtime';

import { createModuleLogger } from '../../logger';
import type { Result } from '@taskforceai/client-core/result';
import { dbManager } from '../database-manager';
import { mobileConversationStore } from './internal';
import { createMobileStorageOperations } from './operations';

const logger = createModuleLogger('ChatLocalMobilePrompts');
const storage = createMobileStorageOperations(logger);

export interface PendingPrompt extends PendingPromptRecord {
  updatedAt: number;
}

export async function enqueuePrompt(
  conversationId: string,
  prompt: string,
  runPayload?: PendingPromptRecord['runPayload']
): Promise<void> {
  return storage.run('[chat-local-mobile] Failed to enqueue prompt:', async () => {
    const parsedRunPayload = runRequestSchema.safeParse(runPayload);
    const normalizedRunPayload = parsedRunPayload.success
      ? parsedRunPayload.data
      : createQueuedRunPayload({
          prompt,
          ...extractQueuedRunPayloadMetadata(runPayload),
        });
    await mobileConversationStore.enqueuePrompt(conversationId, prompt, normalizedRunPayload);
  });
}

export async function updatePromptStatus(
  id: number,
  status: PendingPrompt['status']
): Promise<void> {
  return storage.capture('[chat-local-mobile] Failed to update prompt status:', async () => {
    if (typeof id !== 'number') {
      throw new Error(`[chat-local-mobile] Invalid prompt ID type: ${typeof id}`);
    }
    await dbManager.ensureOrm();
    await mobileConversationStore.updatePromptStatus(id, status);
  });
}

export async function removePrompt(id: number): Promise<void> {
  return storage.capture('[chat-local-mobile] Failed to remove prompt:', async () => {
    if (typeof id !== 'number') {
      throw new Error(`[chat-local-mobile] Invalid prompt ID type: ${typeof id}`);
    }
    await dbManager.ensureOrm();
    await mobileConversationStore.removePrompt(id);
  });
}

export async function listPendingPrompts(): Promise<Result<PendingPrompt[]>> {
  return storage.runResult('[chat-local-mobile] Failed to list pending prompts:', async () => {
    const prompts = await mobileConversationStore.listPendingPrompts();
    return prompts.map((entry) => ({
      id: entry.id,
      conversationId: entry.conversationId,
      prompt: entry.prompt,
      status: entry.status,
      createdAt: entry.createdAt,
      updatedAt: entry.createdAt,
      runPayload: entry.runPayload ?? createQueuedRunPayload({ prompt: entry.prompt }),
    }));
  });
}

export async function clearPendingPrompts(): Promise<void> {
  return storage.run('[chat-local-mobile] Failed to clear prompt queue:', async () => {
    const prompts = await mobileConversationStore.listPendingPrompts();
    await Promise.all(
      prompts
        .filter((prompt): prompt is typeof prompt & { id: number } => typeof prompt.id === 'number')
        .map((prompt) => mobileConversationStore.removePrompt(prompt.id))
    );
  });
}
