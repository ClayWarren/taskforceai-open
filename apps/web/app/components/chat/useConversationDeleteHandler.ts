import { localSearch } from '@taskforceai/client-runtime/local-search';
import { useCallback } from 'react';

import { logger } from '../../lib/logger';
import { confirmDialog } from '../../lib/platform/confirm-dialog';

interface ConversationMessageForDelete {
  messageId?: string;
}

interface ConversationStoreForDelete {
  clearConversation: (conversationId: string) => Promise<unknown>;
  getConversationMessages: (conversationId: string) => Promise<unknown>;
}

interface UseConversationDeleteHandlerOptions {
  conversationStore: ConversationStoreForDelete;
  localConversationLookup: React.RefObject<Map<number, string>>;
  localConversationReverseLookup: React.RefObject<Map<string, number>>;
  reloadConversations: () => Promise<void>;
}

const normalizeError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

export function useConversationDeleteHandler({
  conversationStore,
  localConversationLookup,
  localConversationReverseLookup,
  reloadConversations,
}: UseConversationDeleteHandlerOptions) {
  return useCallback(
    async (id: number) => {
      logger.debug?.('deleteConversation invoked', { id });
      if (!Number.isSafeInteger(id)) {
        logger.warn('Delete conversation aborted: invalid conversation id', { id });
        return;
      }

      let confirmed = false;
      try {
        confirmed = await confirmDialog('Are you sure you want to delete this conversation?', {
          title: 'Delete Conversation',
          kind: 'warning',
        });
      } catch (error: unknown) {
        logger.error('Delete conversation confirmation failed', {
          error: normalizeError(error),
          id,
        });
        return;
      }

      if (!confirmed) {
        return;
      }

      const localId = localConversationLookup.current.get(id);
      if (typeof localId !== 'string' || localId.length === 0) {
        logger.warn('Delete conversation aborted: local conversation mapping missing', { id });
        return;
      }

      let messages: ConversationMessageForDelete[] = [];
      try {
        const fetchedMessages = await conversationStore.getConversationMessages(localId);
        messages = Array.isArray(fetchedMessages) ? fetchedMessages : [];
        if (!Array.isArray(fetchedMessages)) {
          logger.warn('Delete conversation message lookup returned non-array', { id, localId });
        }
      } catch (error: unknown) {
        logger.error('Failed to load messages before deleting local conversation', {
          error: normalizeError(error),
          id,
          localId,
        });
      }

      try {
        await conversationStore.clearConversation(localId);
      } catch (error: unknown) {
        logger.error('Failed to delete local conversation', {
          error: normalizeError(error),
          id,
          localId,
        });
        return;
      }

      for (const message of messages) {
        if (typeof message.messageId !== 'string' || message.messageId.length === 0) {
          logger.warn('Skipping search index cleanup for invalid message id', { id, localId });
          continue;
        }
        try {
          localSearch.removeItem(message.messageId);
        } catch (error: unknown) {
          logger.error('Failed to remove message from search index after conversation delete', {
            error: normalizeError(error),
            id,
            localId,
            messageId: message.messageId,
          });
        }
      }

      localConversationReverseLookup.current.delete(localId);

      try {
        await reloadConversations();
      } catch (error: unknown) {
        logger.error('Failed to refresh local conversations after delete', {
          error: normalizeError(error),
          id,
          localId,
        });
      }
    },
    [
      conversationStore,
      localConversationLookup,
      localConversationReverseLookup,
      reloadConversations,
    ]
  );
}
