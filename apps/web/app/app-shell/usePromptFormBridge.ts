import type { ModelSelectorResponse } from '@taskforceai/contracts/contracts';
import type {
  SessionLifecycleMessageSession,
  StartStreamingOptions,
} from '@taskforceai/react-core';
import type { PendingApproval } from '@taskforceai/shared';
import { definedProps } from '@taskforceai/shared/utils/object';
import { useCallback } from 'react';

import { fulfillPendingMcpApproval } from '../lib/mcp/approval';
import { handleLocalMcpCommand } from '../lib/mcp/local-command';
import { useWebMcpToolCatalog } from '../lib/mcp/useMcpToolCatalog';
import { logger } from '../lib/logger';
import { useConversationStore, usePlatformRuntime } from '../lib/platform/PlatformProvider';
import type { Message } from '../lib/types';
import type { RealtimeVoiceTranscriptMessage } from '../components/chat/prompt-form/useRealtimeVoiceSession';

type UsePromptFormBridgeParams = {
  session: SessionLifecycleMessageSession<Message, StartStreamingOptions>;
  initialModelSelector: ModelSelectorResponse | null;
  isDisabled: boolean;
  updateToRemoteConversation: (_conversationId: number) => void;
  variant: 'centered' | 'bottom';
};

const REALTIME_VOICE_CHAT_MESSAGE_PREFIX = 'realtime-voice-';

const toRealtimeChatMessageId = (messageId: string): string =>
  `${REALTIME_VOICE_CHAT_MESSAGE_PREFIX}${messageId}`;

const isRealtimeVoiceChatMessage = (message: Message): boolean =>
  message.id.startsWith(REALTIME_VOICE_CHAT_MESSAGE_PREFIX);

export function usePromptFormBridge({
  session,
  initialModelSelector,
  isDisabled,
  updateToRemoteConversation,
  variant,
}: UsePromptFormBridgeParams) {
  const runtime = usePlatformRuntime();
  const conversationStore = useConversationStore();
  const { manager, snapshot } = useWebMcpToolCatalog(runtime);

  const handleRealtimeTranscriptMessagesChange = useCallback(
    (transcriptMessages: RealtimeVoiceTranscriptMessage[]) => {
      const normalizedMessages = transcriptMessages
        .filter((message) => message.isEphemeral !== true)
        .map((message) => {
          const text = message.text.trim();
          return {
            id: message.id,
            role: message.role,
            text,
            isStreaming: message.isStreaming,
            isEphemeral: message.isEphemeral,
            chatMessageId: toRealtimeChatMessageId(message.id),
          };
        })
        .filter((message) => message.text.length > 0);

      const nextIds = new Set(normalizedMessages.map((message) => message.chatMessageId));
      const now = Date.now();

      session.conversation.setMessages((previous) => {
        if (normalizedMessages.length === 0) {
          const hasStreamingRealtimeMessage = previous.some(
            (message) => isRealtimeVoiceChatMessage(message) && message.isStreaming === true
          );
          if (!hasStreamingRealtimeMessage) {
            return previous;
          }
          return previous.filter(
            (message) => !isRealtimeVoiceChatMessage(message) || message.isStreaming !== true
          );
        }

        const existingById = new Map(previous.map((message) => [message.id, message]));
        const retainedMessages = previous.filter((message) => {
          if (!isRealtimeVoiceChatMessage(message)) {
            return true;
          }
          if (nextIds.has(message.id)) {
            return false;
          }
          return message.isStreaming !== true;
        });

        const nextTranscriptMessages: Message[] = normalizedMessages.map((message) => {
          const existing = existingById.get(message.chatMessageId);
          const createdAt = existing?.createdAt ?? now;
          return {
            id: message.chatMessageId,
            role: message.role,
            content: message.text,
            isStreaming: message.isStreaming ?? false,
            sources: [],
            toolEvents: [],
            createdAt,
            updatedAt: now,
          };
        });

        return [...retainedMessages, ...nextTranscriptMessages];
      });

      const persistableMessages = normalizedMessages.filter(
        (message) => !message.isEphemeral && !message.isStreaming
      );
      if (persistableMessages.length === 0) {
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
    [conversationStore, session.conversation]
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
      onRealtimeTranscriptMessagesChange: handleRealtimeTranscriptMessagesChange,
    },
  };
}
