import type { ModelSelectorResponse } from '@taskforceai/contracts/contracts';
import type {
  SessionLifecycleMessageSession,
  StartStreamingOptions,
} from '@taskforceai/react-core';
import type { PendingApproval } from '@taskforceai/shared';
import { useCallback } from 'react';

import { fulfillPendingMcpApproval } from '../lib/mcp/approval';
import { handleLocalMcpCommand } from '../lib/mcp/local-command';
import { useWebMcpToolCatalog } from '../lib/mcp/useMcpToolCatalog';
import { useConversationStore, usePlatformRuntime } from '../lib/platform/PlatformProvider';
import type { Message } from '../lib/types';

type UsePromptFormBridgeParams = {
  session: SessionLifecycleMessageSession<Message, StartStreamingOptions>;
  initialModelSelector: ModelSelectorResponse | null;
  isDisabled: boolean;
  updateToRemoteConversation: (_conversationId: number) => void;
  variant: 'centered' | 'bottom';
};

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

  const handleLocalCommand = useCallback(
    (input: {
      prompt: string;
      attachmentIds?: string[];
      computerUseEnabled?: boolean;
      computerUseTarget?: 'virtual' | 'local';
    }) =>
      handleLocalMcpCommand({
        prompt: input.prompt,
        attachmentIds: input.attachmentIds,
        computerUseEnabled: input.computerUseEnabled,
        computerUseTarget: input.computerUseTarget,
        runtime,
        manager,
        ensureConversationId: session.conversation.ensureConversationId,
        setMessages: session.conversation.setMessages,
        conversationStore,
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
    },
  };
}
