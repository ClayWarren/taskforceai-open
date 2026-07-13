import {
  appendLocalAssistantMessage,
  handleLocalMcpCommandCore,
  resolveEnabledMcpServer,
} from '@taskforceai/react-core';

import type { Message } from '../types';
import { upsertMessage } from '../storage/chat-local-mobile';
import type { MobileMcpManager, MobileMcpServerConfig } from './manager';
import { loadStoredMobileMcpServers } from './store';

type HandleMobileLocalMcpCommandParams = {
  prompt: string;
  attachmentIds?: string[];
  manager: MobileMcpManager;
  ensureConversationId: () => Promise<string>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  persistMessages?: boolean;
};

const resolveServer = (serverName: string): Promise<MobileMcpServerConfig> =>
  resolveEnabledMcpServer(serverName, loadStoredMobileMcpServers);

export const handleMobileLocalMcpCommand = async ({
  prompt,
  attachmentIds,
  manager,
  ensureConversationId,
  setMessages,
  persistMessages = true,
}: HandleMobileLocalMcpCommandParams): Promise<boolean> => {
  const result = await handleLocalMcpCommandCore({
    prompt,
    attachmentIds,
    resolveServer,
    executeTool: (server, toolName, argumentsObject) =>
      manager.callTool(server, toolName, argumentsObject),
    appendAssistantMessage: (content) =>
      appendLocalAssistantMessage(
        {
          ensureConversationId,
          setMessages,
          persistMessage: async ({
            conversationId,
            messageId,
            role,
            content: messageContent,
            isStreaming,
          }) => {
            if (!persistMessages) {
              return;
            }
            await upsertMessage({
              conversationId,
              messageId,
              role,
              content: messageContent,
              isStreaming,
            });
          },
        },
        content
      ),
  });

  return result.handled;
};
