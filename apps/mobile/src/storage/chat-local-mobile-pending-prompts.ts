import { runRequestSchema } from '@taskforceai/contracts/contracts';
import type { PendingPromptRecord } from '@taskforceai/client-runtime';
import {
  createQueuedRunPayload,
  extractQueuedRunPayloadMetadata,
} from '@taskforceai/client-runtime';

import { createModuleLogger } from '../logger';
import { dbManager } from './database-manager';
import { mobileConversationStore } from './chat-local-mobile.internal';
import { type Result, err, ok } from '@taskforceai/client-core/result';

const logger = createModuleLogger('ChatLocalMobilePrompts');

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

export interface PendingPrompt extends PendingPromptRecord {
  updatedAt: number;
}

export async function enqueuePrompt(
  conversationId: string,
  prompt: string,
  runPayload?: PendingPromptRecord['runPayload']
): Promise<void> {
  try {
    await dbManager.ensureOrm();
    const parsedRunPayload = runRequestSchema.safeParse(runPayload);
    const normalizedRunPayload = parsedRunPayload.success
      ? parsedRunPayload.data
      : createQueuedRunPayload({
          prompt,
          ...extractQueuedRunPayloadMetadata(runPayload),
        });
    await mobileConversationStore.enqueuePrompt(conversationId, prompt, normalizedRunPayload);
  } catch (error) {
    logStorageError('[chat-local-mobile] Failed to enqueue prompt:', error);
    throw error;
  }
}

export async function updatePromptStatus(
  id: number,
  status: PendingPrompt['status']
): Promise<void> {
  try {
    if (typeof id !== 'number') {
      throw new Error(`[chat-local-mobile] Invalid prompt ID type: ${typeof id}`);
    }
    await dbManager.ensureOrm();
    await mobileConversationStore.updatePromptStatus(id, status);
  } catch (error) {
    logStorageError('[chat-local-mobile] Failed to update prompt status:', error);
    throw error;
  }
}

export async function removePrompt(id: number): Promise<void> {
  try {
    if (typeof id !== 'number') {
      throw new Error(`[chat-local-mobile] Invalid prompt ID type: ${typeof id}`);
    }
    await dbManager.ensureOrm();
    await mobileConversationStore.removePrompt(id);
  } catch (error) {
    logStorageError('[chat-local-mobile] Failed to remove prompt:', error);
    throw error;
  }
}

export async function listPendingPrompts(): Promise<Result<PendingPrompt[]>> {
  try {
    await dbManager.ensureOrm();
    const prompts = await mobileConversationStore.listPendingPrompts();
    return ok(
      prompts.map((entry) => ({
        id: entry.id,
        conversationId: entry.conversationId,
        prompt: entry.prompt,
        status: entry.status,
        createdAt: entry.createdAt,
        updatedAt: entry.createdAt,
        runPayload: entry.runPayload ?? createQueuedRunPayload({ prompt: entry.prompt }),
      }))
    );
  } catch (error) {
    logStorageError('[chat-local-mobile] Failed to list pending prompts:', error);
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

export async function clearPendingPrompts(): Promise<void> {
  try {
    await dbManager.ensureOrm();
    const prompts = await mobileConversationStore.listPendingPrompts();
    await Promise.all(
      prompts
        .filter((prompt): prompt is typeof prompt & { id: number } => typeof prompt.id === 'number')
        .map((prompt) => mobileConversationStore.removePrompt(prompt.id))
    );
  } catch (error) {
    logStorageError('[chat-local-mobile] Failed to clear prompt queue:', error);
    throw error;
  }
}
