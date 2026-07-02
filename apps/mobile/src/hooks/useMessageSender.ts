import { executeSendMessage } from '@taskforceai/client-runtime/send-message';
import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { McpRuntimeToolDescriptor } from '@taskforceai/shared';
import type { PendingApproval } from '@taskforceai/shared/types';

import { enqueuePrompt, upsertMessage } from '../storage/chat-local-mobile';
import type { Message } from '../types';
import { createId } from '@taskforceai/shared/utils/id';
import type { useRunTaskMutation } from './api/runTask';
import { createModuleLogger } from '../logger';
import type { MobileMcpManager } from '../mcp/manager';
import { fulfillPendingMcpApproval } from '../mcp/approval';
import { handleMobileLocalMcpCommand } from '../mcp/local-command';

type RunTaskMutation = ReturnType<typeof useRunTaskMutation>['mutateAsync'];

interface ConversationControls {
  onSendMessage: (content: string) => Promise<void> | void;
  ensureActiveConversation: () => Promise<string>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
}

interface StreamingControls {
  startStreaming: (options: {
    taskId: string;
    conversationId: string;
    prompt: string;
    agentCount?: number;
    computerUseEnabled?: boolean;
    budgetLimit?: number;
    onApproval?: (approval: PendingApproval | null) => Promise<void> | void;
  }) => Promise<void>;
  clearErrorMessage: () => void;
  setErrorMessage: (message: string, resetTime?: string) => void;
}

interface UseMessageSenderOptions {
  conversation: ConversationControls;
  streaming: StreamingControls;
  isOnline: boolean | null;
  triggerRunTask: RunTaskMutation;
  mcpManager: MobileMcpManager;
  mcpToolItems?: McpRuntimeToolDescriptor[];
  invalidatePendingPrompts?: () => void;
}

const logger = createModuleLogger('useMessageSender');

export function useMessageSender({
  conversation,
  streaming,
  isOnline,
  triggerRunTask,
  mcpManager,
  mcpToolItems = [],
  invalidatePendingPrompts,
}: UseMessageSenderOptions) {
  const handleSendMessage = useCallback(
    async (
      content: string,
      metadata?: {
        modelId?: string;
        quickModeEnabled?: boolean;
        computerUseEnabled?: boolean;
        budget?: number;
        agentCount?: number;
      },
      attachment_ids?: string[]
    ) => {
      await executeSendMessage({
        content,
        metadata,
        attachmentIds: attachment_ids,
        isOnline,
        mcpToolItems,
        addVisibleUserMessage: async (visibleContent) => {
          await conversation.onSendMessage(visibleContent);
        },
        ensureConversationId: conversation.ensureActiveConversation,
        setErrorMessage: streaming.setErrorMessage,
        clearErrorMessage: streaming.clearErrorMessage,
        startStreaming: streaming.startStreaming,
        enqueuePrompt,
        invalidatePendingPrompts,
        runTask: async (input) => triggerRunTask(input),
        appendAssistantMessage: async ({ conversationId, content: assistantContent }) => {
          const messageId = createId('assistant');
          const now = Date.now() + 100;
          const assistantMessage = {
            id: messageId,
            role: 'assistant' as const,
            content: assistantContent,
            sources: [],
            toolEvents: [],
            createdAt: now,
            updatedAt: now,
          };
          conversation.setMessages((prev) => [...prev, assistantMessage]);
          await upsertMessage({
            conversationId,
            messageId,
            role: 'assistant',
            content: assistantContent,
            isStreaming: false,
          });
        },
        handleLocalCommand: ({ prompt, attachmentIds }) =>
          handleMobileLocalMcpCommand({
            prompt,
            attachmentIds,
            manager: mcpManager,
            ensureConversationId: conversation.ensureActiveConversation,
            setMessages: conversation.setMessages,
          }),
        handleApproval: (taskId, approval) =>
          fulfillPendingMcpApproval({
            taskId,
            approval,
            manager: mcpManager,
          }).then(() => undefined),
        logger,
      });
    },
    [conversation, invalidatePendingPrompts, isOnline, mcpManager, mcpToolItems, streaming, triggerRunTask]
  );

  return { handleSendMessage };
}
