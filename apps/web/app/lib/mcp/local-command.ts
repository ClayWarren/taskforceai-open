import {
  appendLocalAssistantMessage,
  type AssistantMessagePersistence,
  handleLocalMcpCommandCore,
  resolveEnabledMcpServer,
} from '@taskforceai/react-core';
import { definedProps } from '@taskforceai/client-core/utils/object';

import type { ConversationStore, PlatformRuntime } from '../platform/platform-interfaces';
import type { Message } from '../types';
import {
  enableDesktopLocalCoding,
  executeDesktopAppServerCommand,
  observeDesktopComputerUse,
  openDesktopBrowserPreview,
  showDesktopBrowserPreview,
} from '../platform/desktop/app-server';
import { callDesktopMcpTool, type DesktopMcpServerConfig } from '../platform/desktop/mcp';
import type { WebMcpManager, WebMcpServerConfig } from './manager';
import { readStoredWebMcpServers } from './store';
import { createId } from '@taskforceai/system-runtime/id';
import type { ToolUsageEvent } from '../types';

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
  persistMessages?: boolean;
};

const createLocalAssistantMessageAdapter = (
  context: LocalMcpCommandContext
): AssistantMessagePersistence => ({
  ensureConversationId: context.ensureConversationId,
  setMessages: context.setMessages,
  persistMessage: async (message) => {
    if (context.persistMessages === false) {
      return;
    }
    await context.conversationStore.upsertMessage({
      conversationId: message.conversationId,
      messageId: message.messageId,
      role: message.role,
      content: message.content,
      isStreaming: message.isStreaming,
      ...definedProps({ isLocalCommandOutput: message.isLocalCommandOutput }),
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
    });
  },
});

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

const cleanBrowserUrlCandidate = (value: string): string =>
  value
    .trim()
    .replace(/^[<("'`]+/, '')
    .replace(/[>)"'`,.;!?]+$/, '');

export const parseDesktopBrowserOpenTarget = (prompt: string): string | null => {
  const normalized = prompt.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const hasBrowserIntent =
    /\b(in-app browser|browser|webview|web view)\b/.test(normalized) ||
    /\b(open|pull up|bring up|go to|navigate to|load|visit)\b/.test(normalized);
  if (!hasBrowserIntent) {
    return null;
  }

  const urlMatch = prompt.match(
    /\b((?:https?:\/\/|file:\/\/)[^\s<>"'`]+|(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/[^\s<>"'`]*)?|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s<>"'`]*)?)/i
  );

  return urlMatch?.[1] ? cleanBrowserUrlCandidate(urlMatch[1]) : null;
};

const isDesktopBrowserShowPrompt = (prompt: string): boolean => {
  const normalized = prompt.trim().toLowerCase();
  return (
    /\b(open|show|launch|toggle)\b/.test(normalized) &&
    /\b(in-app browser|browser)\b/.test(normalized) &&
    parseDesktopBrowserOpenTarget(prompt) === null
  );
};

const isLocalComputerUseObservationPrompt = (
  prompt: string,
  options: Pick<LocalMcpCommandContext, 'computerUseEnabled' | 'computerUseTarget' | 'runtime'>
): boolean => {
  if (
    options.runtime !== 'desktop' ||
    options.computerUseEnabled !== true ||
    options.computerUseTarget !== 'local'
  ) {
    return false;
  }
  const normalized = prompt.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  const mentionsLocalComputer =
    normalized.includes('local computer use') ||
    normalized.includes('local computer') ||
    normalized.includes('my screen') ||
    normalized.includes('this screen') ||
    normalized.includes('desktop');
  const asksForObservation =
    normalized.includes('screenshot') ||
    normalized.includes('screen') ||
    normalized.includes('observe') ||
    normalized.includes('look') ||
    normalized.includes('see') ||
    normalized.includes('cursor') ||
    normalized.includes('mouse');
  return mentionsLocalComputer && asksForObservation;
};

const appendAssistantMessage = (
  context: LocalMcpCommandContext,
  content: string,
  options: { isLocalCommandOutput?: boolean; toolEvents?: ToolUsageEvent[] } = {}
) => {
  const toolEvents = options.toolEvents;
  if (!toolEvents || toolEvents.length === 0) {
    return appendLocalAssistantMessage(
      createLocalAssistantMessageAdapter(context),
      content,
      options
    );
  }

  return appendRichAssistantMessage(context, content, { ...options, toolEvents });
};

const appendRichAssistantMessage = async (
  context: LocalMcpCommandContext,
  content: string,
  options: { isLocalCommandOutput?: boolean; toolEvents: ToolUsageEvent[] }
): Promise<void> => {
  const conversationId = await context.ensureConversationId();
  const now = Date.now();
  const messageId = createId('assistant');
  const message: Message = {
    id: messageId,
    role: 'assistant',
    content,
    sources: [],
    toolEvents: options.toolEvents,
    createdAt: now,
    updatedAt: now,
  };
  if (options.isLocalCommandOutput) {
    message.isLocalCommandOutput = true;
  }
  context.setMessages((previous) => [...previous, message]);
  if (context.persistMessages === false) {
    return;
  }
  await context.conversationStore.upsertMessage({
    conversationId,
    messageId,
    role: 'assistant',
    content,
    isStreaming: false,
    ...definedProps({ isLocalCommandOutput: options.isLocalCommandOutput }),
    toolEvents: options.toolEvents,
    createdAt: now,
    updatedAt: now,
  });
};

const runLocalComputerUseObservation = async (
  context: LocalMcpCommandContext
): Promise<{ handled: boolean }> => {
  const startedAt = Date.now();
  const timestamp = new Date(startedAt).toISOString();
  const result = await observeDesktopComputerUse();
  const event: ToolUsageEvent = {
    invocationId: createId('local-computer-use'),
    timestamp,
    agentLabel: 'Local Computer Use',
    toolName: 'computer_use',
    arguments: { action: 'screenshot' },
    status: 'completed',
    success: true,
    durationMs: Date.now() - startedAt,
    resultPreview: JSON.stringify({
      path: result.path,
      mediaType: result.mediaType,
      byteLength: result.byteLength,
      message: result.message,
    }),
    image_base64: result.imageBase64,
  };
  await appendAssistantMessage(context, `Computer Use\n${result.message}`, {
    isLocalCommandOutput: true,
    toolEvents: [event],
  });
  return { handled: true };
};

export const handleLocalMcpCommand = async (
  context: LocalMcpCommandContext
): Promise<{ handled: boolean }> => {
  const mcpResult = await handleLocalMcpCommandCore({
    prompt: context.prompt,
    ...definedProps({ attachmentIds: context.attachmentIds }),
    resolveServer,
    executeTool: (server, toolName, argumentsObject) =>
      context.runtime === 'desktop'
        ? callDesktopMcpTool(server as DesktopMcpServerConfig, toolName, argumentsObject)
        : context.manager.callTool(server, toolName, argumentsObject),
    appendAssistantMessage: (content) =>
      appendLocalAssistantMessage(createLocalAssistantMessageAdapter(context), content),
  });

  if (mcpResult.handled) {
    return mcpResult;
  }

  const trimmedPrompt = context.prompt.trim();
  if (context.runtime === 'desktop') {
    if (isLocalComputerUseObservationPrompt(trimmedPrompt, context)) {
      return runLocalComputerUseObservation(context);
    }

    const browserTarget = parseDesktopBrowserOpenTarget(trimmedPrompt);
    if (browserTarget) {
      const status = await openDesktopBrowserPreview({ url: browserTarget });
      const destination = status.currentUrl ?? browserTarget;
      await appendAssistantMessage(
        context,
        `Browser\nOpened ${destination} in the in-app browser.`,
        {
          isLocalCommandOutput: true,
        }
      );
      return { handled: true };
    }

    if (isDesktopBrowserShowPrompt(trimmedPrompt)) {
      const status = await showDesktopBrowserPreview();
      const destination = status.currentUrl ? ` Current page: ${status.currentUrl}` : '';
      await appendAssistantMessage(context, `Browser\nIn-app browser is open.${destination}`, {
        isLocalCommandOutput: true,
      });
      return { handled: true };
    }
  }

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
