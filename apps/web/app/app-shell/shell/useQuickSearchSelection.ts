import { useCallback } from 'react';

import { logger } from '../../lib/logger';
import type { QuickSearchRecord } from './AppShellOverlays';

interface UseQuickSearchSelectionOptions {
  closeQuickSearch: () => void;
  loadConversation: (summary: {
    id: number;
    user_input: string;
    timestamp: string;
    result: string;
    model: string;
  }) => Promise<void>;
  navigateHome: () => Promise<void> | void;
  resetStreamingState: () => void;
}

export function useQuickSearchSelection({
  closeQuickSearch,
  loadConversation,
  navigateHome,
  resetStreamingState,
}: UseQuickSearchSelectionOptions) {
  return useCallback(
    async (record: QuickSearchRecord) => {
      resetStreamingState();
      const summary = {
        id: -(Date.now() % 1000000),
        user_input: record.title || 'Conversation',
        timestamp: new Date(record.updatedAt).toISOString(),
        result: record.lastMessagePreview ?? '',
        model: record.conversationId,
      };

      try {
        await loadConversation(summary);
        closeQuickSearch();
        void Promise.resolve(navigateHome());
      } catch (error) {
        logger.error('Failed to load conversation from quick search', { error });
      }
    },
    [closeQuickSearch, loadConversation, navigateHome, resetStreamingState]
  );
}
