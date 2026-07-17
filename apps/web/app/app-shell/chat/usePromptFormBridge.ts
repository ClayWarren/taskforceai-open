import type { ModelSelectorResponse } from '@taskforceai/contracts/contracts';
import type {
  SessionLifecycleMessageSession,
  StartStreamingOptions,
} from '@taskforceai/react-core';
import { createRealtimeVoiceChatTranscriptUpdate } from '@taskforceai/react-core';
import type { PendingApproval } from '@taskforceai/client-core';
import { definedProps } from '@taskforceai/client-core/utils/object';
import { useCallback } from 'react';

import { fulfillPendingMcpApproval } from '../../lib/mcp/approval';
import { handleLocalMcpCommand } from '../../lib/mcp/local-command';
import { useWebMcpToolCatalog } from '../../lib/mcp/useMcpToolCatalog';
import { logger } from '../../lib/logger';
import { useConversationStore, usePlatformRuntime } from '../../lib/platform/PlatformProvider';
import type { Message } from '../../lib/types';
import type { RealtimeVoiceTranscriptMessage } from '../../components/chat/prompt-form';

type UsePromptFormBridgeParams = {
  session: SessionLifecycleMessageSession<Message, StartStreamingOptions>;
  initialModelSelector: ModelSelectorResponse | null;
  isDisabled: boolean;
  isPrivateChat?: boolean;
  persistenceEnabled?: boolean;
  updateToRemoteConversation: (_conversationId: number) => void;
  variant: 'centered' | 'bottom';
};

export function usePromptFormBridge({
  session,
  initialModelSelector,
  isDisabled,
  isPrivateChat = false,
  persistenceEnabled = true,
  updateToRemoteConversation,
  variant,
}: UsePromptFormBridgeParams) {
  const runtime = usePlatformRuntime();
  const conversationStore = useConversationStore();
  const { manager, snapshot } = useWebMcpToolCatalog(runtime);

  const handleRealtimeTranscriptMessagesChange = useCallback(
    (transcriptMessages: RealtimeVoiceTranscriptMessage[]) => {
      const transcriptUpdate = createRealtimeVoiceChatTranscriptUpdate(transcriptMessages);

      session.conversation.setMessages((previous) => transcriptUpdate.apply(previous) as Message[]);

      const { now, persistableMessages } = transcriptUpdate;
      if (!persistenceEnabled || persistableMessages.length === 0) {
        return;
      }

      void (async () => {
        const conversationId = await session.conversation.ensureConversationId();
        await Promise.all(
          persistableMessages.map((message) =>
            conversationStore.upsertMessage({
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
      })().catch((error) => {
        logger.error('Failed to persist realtime voice transcript messages', { error });
      });
    },
    [conversationStore, persistenceEnabled, session.conversation]
  );

  const handleLocalCommand = useCallback(
    (input: {
      prompt: string;
      attachmentIds?: string[];
      computerUseEnabled?: boolean;
      computerUseTarget?: 'virtual' | 'local';
    }) =>
      handleLocalMcpCommand({
        prompt: input.prompt,
        runtime,
        manager,
        persistMessages: persistenceEnabled,
        ensureConversationId: session.conversation.ensureConversationId,
        setMessages: session.conversation.setMessages,
        conversationStore,
        ...definedProps({
          attachmentIds: input.attachmentIds,
          computerUseEnabled: input.computerUseEnabled,
          computerUseTarget: input.computerUseTarget,
        }),
      }).then((result) => result.handled),
    [
      conversationStore,
      manager,
      persistenceEnabled,
      runtime,
      session.conversation.ensureConversationId,
      session.conversation.setMessages,
    ]
  );

  const handleMcpApproval = useCallback(
    (taskId: string, approval: PendingApproval | null) =>
      fulfillPendingMcpApproval({
        taskId,
        approval,
        runtime,
        manager,
      }).then(() => undefined),
    [manager, runtime]
  );

  return {
    mcpToolCatalog: snapshot,
    promptFormProps: {
      onSendMessage: (content: string) => {
        void session.conversation.onSendMessage(content);
      },
      onLocalCommand: handleLocalCommand,
      onMcpApproval: handleMcpApproval,
      onConversationId: (conversationId: number) => {
        updateToRemoteConversation(conversationId);
      },
      clearErrorMessage: session.streaming.clearErrorMessage,
      variant,
      isDisabled,
      ensureConversationId: session.conversation.ensureConversationId,
      initialModelSelector,
      persistMessages: persistenceEnabled,
      privateChat: isPrivateChat,
      onRealtimeTranscriptMessagesChange: handleRealtimeTranscriptMessagesChange,
    },
  };
}
