import { useQueryClient } from '@tanstack/react-query';
import {
  createRealtimeVoiceChatTranscriptUpdate,
  usePrivateChatMode,
  useSessionLifecycleController,
} from '@taskforceai/react-core';
import { useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '../contexts/AuthContext';
import { useStreamingStore } from '../streaming/useStreamingStore';
import { useSync } from '../contexts/SyncContext';
import { createModuleLogger } from '../logger';
import { queryKeys } from './api/queryKeys';
import { useRunTaskMutation } from './api/runTask';
import { useCacheMaintenance } from './useCacheMaintenance';
import { useConversationState } from './useConversationState';
import { useMessageSender } from './useMessageSender';
import { usePendingPromptQueue } from './usePendingPromptQueue';
import { useStreamingMessages } from './useStreamingMessages';
import { deleteMessage, ensureConversation, upsertMessage } from '../storage/chat-local-mobile';
import { useMobileMcpToolCatalog } from '../mcp/useMcpToolCatalog';
import { requestAiDataSharingConsent } from '../privacy/aiDataConsent';
import { createId } from '@taskforceai/system-runtime/id';
import type { Message } from '../types';
import type { RealtimeVoiceTranscriptMessage } from './useRealtimeVoiceSession';

const messagePersistence = { upsertMessage, deleteMessage };
const logger = createModuleLogger('useChatCoordinator');

export function useChatCoordinator() {
  const router = useRouter();
  const { isAuthenticated, isLoading, logout, user } = useAuth();
  const [isSidebarVisible, setIsSidebarVisible] = useState(false);
  const streamingContext = useStreamingStore();
  const { isStreaming, computerUseEnabled } = streamingContext;
  const privateChatMode = usePrivateChatMode({
    isAuthenticated,
    isAuthLoading: isLoading,
    isStreaming,
  });
  const { isPrivateChat } = privateChatMode;

  const conversation = useConversationState({
    isAuthenticated,
    sessionStatus: isLoading ? 'loading' : isAuthenticated ? 'authenticated' : 'unauthenticated',
    user,
    isPrivateMode: isPrivateChat,
  });
  const { isOnline } = useSync();
  const { mutateAsync: triggerRunTask } = useRunTaskMutation();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const { manager: mcpManager, snapshot: mcpToolCatalog } = useMobileMcpToolCatalog();
  const { ensureActiveConversation, setMessages } = conversation;
  const { clearErrorMessage, reset: resetStreamingStore, setErrorMessage } = streamingContext;
  const persistedRealtimeTranscriptMessagesRef = useRef(new Map<string, string>());
  const realtimeTranscriptPersistenceQueueRef = useRef<Promise<void>>(Promise.resolve());

  const invalidatePendingPrompts = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.pendingPrompts });
  }, [queryClient]);

  const { handleClearCache } = useCacheMaintenance({
    conversation,
    logout: isAuthenticated ? logout : undefined,
    translate: t,
  });
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
    persistenceEnabled: !isPrivateChat,
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
        privateChatMode.disablePrivateChat();
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
    privateChat: isPrivateChat,
    persistMessages: !isPrivateChat,
  });

  const handleTogglePrivateChat = useCallback(() => {
    resetStreamingStore();
    resetStreamingState();
    privateChatMode.togglePrivateChat();
  }, [privateChatMode, resetStreamingState, resetStreamingStore]);

  const handleExitPrivateChat = useCallback(() => {
    if (!isPrivateChat) {
      return;
    }
    void handleNewChat();
    privateChatMode.disablePrivateChat();
  }, [handleNewChat, isPrivateChat, privateChatMode]);

  const handleLogin = useCallback(() => {
    router.push('/login');
  }, [router]);

  const handleReviewedSendMessage = useCallback(
    async (...args: Parameters<typeof handleSendMessage>) => {
      if (!isAuthenticated) {
        const [content] = args;
        const conversationId = await conversation.ensureActiveConversation();
        await conversation.addUserMessage(content);

        const messageId = createId('assistant');
        const now = Date.now() + 100;
        const assistantContent = t(
          'auth.signInRequiredForAi',
          'Saved locally. Sign in with a free account to run AI tasks, sync conversations, use projects, connect desktop sessions, or manage paid plans.'
        );
        conversation.setMessages((prev) => [
          ...prev,
          {
            id: messageId,
            role: 'assistant' as const,
            content: assistantContent,
            sources: [],
            toolEvents: [],
            createdAt: now,
            updatedAt: now,
          },
        ]);
        await upsertMessage({
          conversationId,
          messageId,
          role: 'assistant',
          content: assistantContent,
          isStreaming: false,
        });
        streamingContext.clearErrorMessage();
        return;
      }

      const consented = await requestAiDataSharingConsent();
      if (!consented) {
        streamingContext.setErrorMessage(
          t('privacy.aiDataSharingRequired', 'Allow AI provider data sharing to send messages.')
        );
        return;
      }
      await handleSendMessage(...args);
    },
    [conversation, handleSendMessage, isAuthenticated, streamingContext, t]
  );

  const handleRealtimeVoiceStart = useCallback(() => {
    clearErrorMessage();
    void ensureActiveConversation().catch((error: unknown) => {
      logger.warn('Failed to prepare conversation for realtime voice', { error });
    });
  }, [clearErrorMessage, ensureActiveConversation]);

  const handleRealtimeTranscriptMessagesChange = useCallback(
    (transcriptMessages: RealtimeVoiceTranscriptMessage[]) => {
      if (transcriptMessages.length === 0) {
        persistedRealtimeTranscriptMessagesRef.current.clear();
      }

      const transcriptUpdate = createRealtimeVoiceChatTranscriptUpdate(transcriptMessages);

      setMessages((previous) =>
        transcriptUpdate.apply(previous) as Message[]
      );
      const { now, persistableMessages } = transcriptUpdate;
      if (isPrivateChat) {
        return;
      }
      const nextPersistableMessages = persistableMessages.filter(
        (message) =>
          persistedRealtimeTranscriptMessagesRef.current.get(message.chatMessageId) !== message.text
      );
      if (nextPersistableMessages.length === 0) {
        return;
      }
      for (const message of nextPersistableMessages) {
        persistedRealtimeTranscriptMessagesRef.current.set(message.chatMessageId, message.text);
      }

      const persistence = realtimeTranscriptPersistenceQueueRef.current
        .catch(() => undefined)
        .then(async () => {
        const conversationId = await ensureActiveConversation();
        const title =
          nextPersistableMessages.find((message) => message.role === 'user')?.text ??
          nextPersistableMessages[0]?.text ??
          'Voice conversation';
        await ensureConversation(conversationId, title.slice(0, 120) || 'Voice conversation');
        await Promise.all(
          nextPersistableMessages.map((message) =>
            upsertMessage({
              conversationId,
              messageId: message.chatMessageId,
              role: message.role,
              content: message.text,
              isStreaming: false,
              createdAt: now,
              updatedAt: now,
            })
          )
        );
        void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
      });
      realtimeTranscriptPersistenceQueueRef.current = persistence;

      void persistence.catch((error) => {
        const currentFailedMessages = nextPersistableMessages.filter(
          (message) =>
            persistedRealtimeTranscriptMessagesRef.current.get(message.chatMessageId) ===
            message.text
        );
        for (const message of currentFailedMessages) {
          persistedRealtimeTranscriptMessagesRef.current.delete(message.chatMessageId);
        }
        logger.error('Failed to persist realtime voice transcript', { error });
        if (currentFailedMessages.length > 0) {
          setErrorMessage(
            t('voice.realtimeTranscriptPersistFailed', 'Failed to save voice transcript.')
          );
        }
      });
    },
    [ensureActiveConversation, isPrivateChat, queryClient, setErrorMessage, setMessages, t]
  );

  const handleOpenSidebar = useCallback(() => {
    setIsSidebarVisible(true);
  }, []);

  const handleCloseSidebar = useCallback(() => {
    setIsSidebarVisible(false);
  }, []);

  usePendingPromptQueue({
    isOnline: !isPrivateChat && (isOnline ?? false),
    isStreaming,
    startStreaming: pendingPromptReplay.startStreaming,
    invalidatePendingPrompts: pendingPromptReplay.invalidatePendingPrompts,
  });

  return {
    isAuthenticated,
    isPrivateChat,
    isPrivateChatToggleDisabled: privateChatMode.isPrivateChatToggleDisabled,
    shouldRenderPrivateChatToggle: privateChatMode.shouldRenderPrivateChatToggle,
    handleTogglePrivateChat,
    handleExitPrivateChat,
    isSidebarVisible,
    setIsSidebarVisible,
    handleOpenSidebar,
    handleCloseSidebar,
    conversation,
    streamingContext,
    handleSendMessage: handleReviewedSendMessage,
    handleRealtimeTranscriptMessagesChange,
    handleRealtimeVoiceStart,
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
