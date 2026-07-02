import { parseMcpCallCommand } from '@taskforceai/shared';
import type { Message } from '@taskforceai/shared/chat/types';
import { createId } from '@taskforceai/shared/utils/id';
import type { Dispatch, SetStateAction } from 'react';

import type { McpServerConfig } from './mcpManager';

export type AssistantMessagePersistence = {
  ensureConversationId: () => Promise<string>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  persistMessage: (params: {
    conversationId: string;
    messageId: string;
    role: 'assistant';
    content: string;
    isStreaming: false;
    isLocalCommandOutput?: boolean;
    createdAt: number;
    updatedAt: number;
  }) => Promise<void>;
};

export type HandleLocalMcpCommandCoreOptions<TServerConfig extends McpServerConfig> = {
  prompt: string;
  attachmentIds?: string[];
  resolveServer: (serverName: string) => Promise<TServerConfig> | TServerConfig;
  executeTool: (
    server: TServerConfig,
    toolName: string,
    argumentsObject: Record<string, unknown>
  ) => Promise<unknown>;
  appendAssistantMessage: (content: string) => Promise<void>;
};

export const formatMcpToolResult = (result: unknown): string => {
  if (!result || typeof result !== 'object') {
    return 'MCP tool returned no result.';
  }

  const record = result as Record<string, unknown>;
  const content = Array.isArray(record['content']) ? record['content'] : [];
  const textBlocks = content
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return '';
      }
      const block = item as Record<string, unknown>;
      if (block['type'] === 'text' && typeof block['text'] === 'string') {
        return block['text'].trim();
      }
      return '';
    })
    .filter((value) => value.length > 0);

  if (textBlocks.length > 0) {
    return textBlocks.join('\n\n');
  }

  if (record['structuredContent'] !== undefined) {
    return JSON.stringify(record['structuredContent'], null, 2);
  }

  if (record['content'] !== undefined) {
    return JSON.stringify(record['content'], null, 2);
  }

  return JSON.stringify(record, null, 2);
};

export const appendLocalAssistantMessage = async (
  persistence: AssistantMessagePersistence,
  content: string,
  options: { isLocalCommandOutput?: boolean } = {}
): Promise<void> => {
  const conversationId = await persistence.ensureConversationId();
  const now = Date.now();
  const messageId = createId('assistant');
  const message: Message = {
    id: messageId,
    role: 'assistant',
    content,
    sources: [],
    toolEvents: [],
    createdAt: now,
    updatedAt: now,
  };
  if (options.isLocalCommandOutput) {
    message.isLocalCommandOutput = true;
  }

  persistence.setMessages((previous) => [...previous, message]);
  await persistence.persistMessage({
    conversationId,
    messageId,
    role: 'assistant',
    content,
    isStreaming: false,
    ...(options.isLocalCommandOutput ? { isLocalCommandOutput: true } : {}),
    createdAt: now,
    updatedAt: now,
  });
};

export const handleLocalMcpCommandCore = async <TServerConfig extends McpServerConfig>({
  prompt,
  attachmentIds,
  resolveServer,
  executeTool,
  appendAssistantMessage,
}: HandleLocalMcpCommandCoreOptions<TServerConfig>): Promise<{ handled: boolean }> => {
  const parsed = parseMcpCallCommand(prompt);
  if (!parsed) {
    return { handled: false };
  }

  let responseText: string;
  try {
    if ((attachmentIds?.length ?? 0) > 0) {
      throw new Error('MCP local commands do not support attachments.');
    }

    const server = await resolveServer(parsed.serverName);
    const result = await executeTool(server, parsed.toolName, parsed.argumentsObject);
    responseText = formatMcpToolResult(result);
  } catch (error) {
    responseText = `MCP call failed: ${error instanceof Error ? error.message : String(error)}`;
  }

  await appendAssistantMessage(responseText);
  return { handled: true };
};
