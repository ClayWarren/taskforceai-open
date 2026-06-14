import { useQueryClient } from '@tanstack/react-query';
import { useSessionLifecycleController } from '@taskforceai/react-core';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '../contexts/AuthContext';
import { useStreamingStore } from '../streaming/useStreamingStore';
import { useSync } from '../contexts/SyncContext';
import { queryKeys } from './api/queryKeys';
import { useRunTaskMutation } from './api/runTask';
import { useCacheMaintenance } from './useCacheMaintenance';
import { useConversationState } from './useConversationState';
import { useMessageSender } from './useMessageSender';
import { usePendingPromptQueue } from './usePendingPromptQueue';
import { useStreamingMessages } from './useStreamingMessages';
import { deleteMessage, upsertMessage } from '../storage/chat-local-mobile';
import { useMobileMcpToolCatalog } from '../mcp/useMcpToolCatalog';
import { requestAiDataSharingConsent } from '../privacy/aiDataConsent';

const messagePersistence = { upsertMessage, deleteMessage };

export function useChatCoordinator() {
  const router = useRouter();
  const { isAuthenticated, isLoading, logout, user } = useAuth();
  const [isSidebarVisible, setIsSidebarVisible] = useState(false);

  const conversation = useConversationState({
    isAuthenticated,
    sessionStatus: isLoading ? 'loading' : isAuthenticated ? 'authenticated' : 'unauthenticated',
    user,
  });
  const streamingContext = useStreamingStore();
  const { isOnline } = useSync();
  const { mutateAsync: triggerRunTask } = useRunTaskMutation();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const { manager: mcpManager, snapshot: mcpToolCatalog } = useMobileMcpToolCatalog();

  const invalidatePendingPrompts = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.pendingPrompts });
  }, [queryClient]);

  const { handleClearCache } = useCacheMaintenance({
    conversation,
    logout: isAuthenticated ? logout : undefined,
    translate: t,
  });
  const { isStreaming, computerUseEnabled, clearErrorMessage } = streamingContext;
  const { resetStreamingState } = useStreamingMessages({
    isStreaming: streamingContext.isStreaming,
    streamContent: streamingContext.streamContent,
    finalResponse: streamingContext.finalResponse,
    errorMessage: streamingContext.errorMessage,
    conversationId: conversation.conversationId,
    ensureActiveConversation: conversation.ensureActiveConversation,
    setMessages: conversation.setMessages,
    sources: streamingContext.sources,
    finalSources: streamingContext.finalSources,
    toolEvents: streamingContext.toolEvents,
    finalToolEvents: streamingContext.finalToolEvents,
    elapsedSeconds: streamingContext.elapsedSeconds,
    agentStatuses: streamingContext.agentStatuses,
    persistence: messagePersistence,
  });

  const { handleNewChat, handleConversationSelect, messageSession, pendingPromptReplay } =
    useSessionLifecycleController({
      conversation,
      messaging: {
        conversation: {
          addUserMessage: conversation.addUserMessage,
          ensureActiveConversation: conversation.ensureActiveConversation,
          setMessages: conversation.setMessages,
        },
        streaming: {
          startStreaming: streamingContext.startStreaming,
          clearErrorMessage: streamingContext.clearErrorMessage,
          setErrorMessage: streamingContext.setErrorMessage,
        },
      },
      resetStreamingState,
      invalidatePendingPrompts,
      afterNewChat: () => {
        setIsSidebarVisible(false);
        clearErrorMessage();
      },
      afterConversationSelect: async () => {
        setIsSidebarVisible(false);
      },
    });

  if (!messageSession || !pendingPromptReplay) {
    throw new Error('useChatCoordinator requires a session lifecycle controller with messaging');
  }

  const { handleSendMessage } = useMessageSender({
    conversation: messageSession.conversation,
    streaming: messageSession.streaming,
    isOnline,
    triggerRunTask,
    mcpManager,
    mcpToolItems: mcpToolCatalog.items,
    invalidatePendingPrompts: messageSession.invalidatePendingPrompts,
  });

  const handleLogin = useCallback(() => {
    router.push('/login');
  }, [router]);

  const handleReviewedSendMessage = useCallback(
    async (...args: Parameters<typeof handleSendMessage>) => {
      const consented = await requestAiDataSharingConsent();
      if (!consented) {
        streamingContext.setErrorMessage(
          t('privacy.aiDataSharingRequired', 'Allow AI provider data sharing to send messages.')
        );
        return;
      }

      if (!isAuthenticated) {
        streamingContext.setErrorMessage(
          t(
            'auth.signInRequired',
            'Sign in to continue this conversation and save your chat history.'
          )
        );
        router.push('/login');
        return;
      }
      await handleSendMessage(...args);
    },
    [handleSendMessage, isAuthenticated, router, streamingContext, t]
  );

  const handleOpenSidebar = useCallback(() => {
    setIsSidebarVisible(true);
  }, []);

  const handleCloseSidebar = useCallback(() => {
    setIsSidebarVisible(false);
  }, []);

  usePendingPromptQueue({
    isOnline: isOnline ?? false,
    isStreaming,
    startStreaming: pendingPromptReplay.startStreaming,
    invalidatePendingPrompts: pendingPromptReplay.invalidatePendingPrompts,
  });

  return {
    isAuthenticated,
    isSidebarVisible,
    setIsSidebarVisible,
    handleOpenSidebar,
    handleCloseSidebar,
    conversation,
    streamingContext,
    handleSendMessage: handleReviewedSendMessage,
    handleNewChat,
    handleConversationSelect,
    handleLogin,
    handleClearCache,
    isOnline,
    computerUseEnabled,
    mcpToolSummary: mcpToolCatalog.toolSummary,
    mcpToolItems: mcpToolCatalog.items,
  };
}
