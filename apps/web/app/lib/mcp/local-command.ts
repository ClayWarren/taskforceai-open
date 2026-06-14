import {
  appendLocalAssistantMessage,
  handleLocalMcpCommandCore,
  resolveEnabledMcpServer,
} from '@taskforceai/react-core';

import type { ConversationStore, PlatformRuntime } from '../platform/platform-interfaces';
import type { Message } from '../types';
import {
  enableDesktopLocalCoding,
  executeDesktopAppServerCommand,
} from '../platform/desktop/app-server';
import { callDesktopMcpTool, type DesktopMcpServerConfig } from '../platform/desktop/mcp';
import type { WebMcpManager, WebMcpServerConfig } from './manager';
import { readStoredWebMcpServers } from './store';

type LocalMcpCommandContext = {
  prompt: string;
  attachmentIds?: string[];
  computerUseEnabled?: boolean;
  computerUseTarget?: 'virtual' | 'local';
  runtime: PlatformRuntime;
  manager: WebMcpManager;
  ensureConversationId: () => Promise<string>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  conversationStore: ConversationStore;
};

const resolveServer = (serverName: string): Promise<WebMcpServerConfig> =>
  resolveEnabledMcpServer(serverName, readStoredWebMcpServers);

const parseCodeWorkspace = (prompt: string): string | null => {
  const trimmed = prompt.trim();
  const [command, ...rest] = trimmed.split(/\s+/);
  if (command !== '/code' && command !== '/coding' && command !== '/workspace') {
    return null;
  }
  return rest.join(' ').trim();
};

const appendAssistantMessage = (
  context: LocalMcpCommandContext,
  content: string,
  options: { isLocalCommandOutput?: boolean } = {}
) =>
  appendLocalAssistantMessage(
    {
      ensureConversationId: context.ensureConversationId,
      setMessages: context.setMessages,
      persistMessage: async ({
        conversationId,
        messageId,
        role,
        content: messageContent,
        isStreaming,
        isLocalCommandOutput,
        createdAt,
        updatedAt,
      }) => {
        await context.conversationStore.upsertMessage({
          conversationId,
          messageId,
          role,
          content: messageContent,
          isStreaming,
          isLocalCommandOutput,
          createdAt,
          updatedAt,
        });
      },
    },
    content,
    options
  );

export const handleLocalMcpCommand = async (
  context: LocalMcpCommandContext
): Promise<{ handled: boolean }> => {
  const mcpResult = await handleLocalMcpCommandCore({
    prompt: context.prompt,
    attachmentIds: context.attachmentIds,
    resolveServer,
    executeTool: (server, toolName, argumentsObject) =>
      context.runtime === 'desktop'
        ? callDesktopMcpTool(server as DesktopMcpServerConfig, toolName, argumentsObject)
        : context.manager.callTool(server, toolName, argumentsObject),
    appendAssistantMessage: (content) =>
      appendLocalAssistantMessage(
        {
          ensureConversationId: context.ensureConversationId,
          setMessages: context.setMessages,
          persistMessage: async ({
            conversationId,
            messageId,
            role,
            content: messageContent,
            isStreaming,
            isLocalCommandOutput,
            createdAt,
            updatedAt,
          }) => {
            await context.conversationStore.upsertMessage({
              conversationId,
              messageId,
              role,
              content: messageContent,
              isStreaming,
              isLocalCommandOutput,
              createdAt,
              updatedAt,
            });
          },
        },
        content
      ),
  });

  if (mcpResult.handled) {
    return mcpResult;
  }

  const trimmedPrompt = context.prompt.trim();
  if (context.runtime !== 'desktop' || !trimmedPrompt.startsWith('/')) {
    return { handled: false };
  }

  const codeWorkspace = parseCodeWorkspace(trimmedPrompt);
  if (codeWorkspace !== null) {
    if (!codeWorkspace) {
      await appendAssistantMessage(context, 'Code\nUsage: /code <project-directory>', {
        isLocalCommandOutput: true,
      });
      return { handled: true };
    }
    const result = await enableDesktopLocalCoding({ workspace: codeWorkspace });
    const serverNames =
      result.serverNames && result.serverNames.length > 0
        ? result.serverNames.join(', ')
        : result.serverName;
    const message = `Workspace tools enabled for ${result.workspace}.\nUse explicit local workspace actions for file operations. Enabled MCP servers: ${serverNames}.`;
    await appendAssistantMessage(context, `Code\n${message}`, { isLocalCommandOutput: true });
    return { handled: true };
  }

  const result = await executeDesktopAppServerCommand({ input: trimmedPrompt });
  const content = result.message.trim()
    ? `${result.title}\n${result.message}`
    : result.title || 'Command executed.';
  await appendAssistantMessage(context, content, { isLocalCommandOutput: true });
  return { handled: true };
};
