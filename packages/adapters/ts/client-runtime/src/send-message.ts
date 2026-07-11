import { ApiClientError } from '@taskforceai/api-client/client';
import type { RunRequest } from '@taskforceai/contracts/contracts';
import { buildMcpClientToolsOption, type McpRuntimeToolDescriptor } from '@taskforceai/client-core';
import type { PendingApproval } from '@taskforceai/client-core/types';
import { definedProps } from '@taskforceai/client-core/utils/object';

import { hasQueuedMcpClientTools } from './queued-run-payload';
import type { PendingPromptRecord } from './types';

const PRIVATE_CHAT_OFFLINE_MESSAGE = 'Private Chat is unavailable offline. Reconnect to send.';
const PRIVATE_CHAT_UNSAVED_RETRY_MESSAGE =
  'Private Chat could not send. This prompt was not saved for retry.';
const MCP_CLIENT_TOOLS_OFFLINE_MESSAGE =
  'Prompts that use local MCP tools are unavailable offline. Reconnect to send.';
const MCP_CLIENT_TOOLS_UNSAVED_RETRY_MESSAGE =
  'Prompts that use local MCP tools require a live approval session. This prompt was not saved for retry.';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const defaultArray = <T>(value: T[] | undefined): T[] => value ?? [];

export interface SendMessageMetadata {
  modelId?: string;
  reasoningEffort?: string;
  quickModeEnabled?: boolean;
  computerUseEnabled?: boolean;
  budget?: number;
  agentCount?: number;
  privateChat?: boolean;
}

export interface SendMessageRunTaskResponse {
  task_id: string;
  status?: string | null;
  result?: string | null;
  conversation_id?: string | number | null;
}

export interface SendMessageRuntimeOptions {
  content: string;
  metadata?: SendMessageMetadata;
  attachmentIds?: string[];
  isOnline: boolean | null;
  mcpToolItems?: McpRuntimeToolDescriptor[];
  addVisibleUserMessage: (content: string) => Promise<void>;
  ensureConversationId: () => Promise<string>;
  setErrorMessage: (message: string, resetTime?: string) => void;
  clearErrorMessage: () => void;
  startStreaming: (options: {
    taskId: string;
    conversationId: string;
    prompt: string;
    agentCount?: number;
    computerUseEnabled?: boolean;
    budgetLimit?: number;
    onApproval?: (approval: PendingApproval | null) => Promise<void> | void;
  }) => Promise<void>;
  enqueuePrompt: (
    conversationId: string,
    prompt: string,
    runPayload?: PendingPromptRecord['runPayload']
  ) => Promise<void>;
  invalidatePendingPrompts?: () => void;
  runTask: (input: RunRequest) => Promise<SendMessageRunTaskResponse>;
  appendAssistantMessage: (input: { conversationId: string; content: string }) => Promise<void>;
  handleLocalCommand?: (input: { prompt: string; attachmentIds?: string[] }) => Promise<boolean>;
  handleApproval?: (taskId: string, approval: PendingApproval | null) => Promise<void> | void;
  logger: {
    error: (message: string, metadata?: unknown) => void;
  };
}

const ATTACHMENT_ONLY_PROMPT = 'Please analyze the attached file(s).';

const attachmentDisplayContent = (attachmentCount: number): string =>
  `[Attached ${attachmentCount} file${attachmentCount === 1 ? '' : 's'}]`;

const resolveDisplayContent = (
  content: string,
  hasText: boolean,
  attachmentCount: number
): string => {
  if (hasText) return content;
  return attachmentCount > 0 ? attachmentDisplayContent(attachmentCount) : content;
};

export const resolvePromptContent = (content: string, attachmentIds?: string[]) => {
  const trimmed = content.trim();
  const attachmentCount = attachmentIds?.length ?? 0;
  const hasAttachments = attachmentCount > 0;
  const promptForTask = trimmed.length > 0 || !hasAttachments ? content : ATTACHMENT_ONLY_PROMPT;
  const displayContent = resolveDisplayContent(content, trimmed.length > 0, attachmentCount);

  return { promptForTask, displayContent };
};

const buildRunPayload = (options: {
  prompt: string;
  metadata?: SendMessageMetadata;
  attachmentIds?: string[];
  taskOptions: Record<string, unknown>;
}): RunRequest => {
  const { prompt, metadata, attachmentIds, taskOptions } = options;
  return {
    prompt,
    demo: false,
    ...(metadata?.privateChat ? { private_chat: true } : {}),
    ...(attachmentIds && attachmentIds.length ? { attachment_ids: attachmentIds } : {}),
    ...(metadata?.modelId ? { modelId: metadata.modelId } : {}),
    ...(metadata?.reasoningEffort ? { reasoningEffort: metadata.reasoningEffort } : {}),
    ...(metadata?.budget !== undefined ? { budget: metadata.budget } : {}),
    ...(Object.keys(taskOptions).length > 0 ? { options: taskOptions } : {}),
  };
};

const buildSendMessageRunRequest = (options: {
  prompt: string;
  metadata?: SendMessageMetadata;
  attachmentIds?: string[];
  mcpToolItems?: McpRuntimeToolDescriptor[];
}): { runPayload: RunRequest; resolvedAgentCount: number | undefined } => {
  const { prompt, metadata, attachmentIds, mcpToolItems = [] } = options;
  const taskOptions: Record<string, unknown> = {};
  const resolvedQuickModeEnabled = metadata?.quickModeEnabled ?? true;
  const resolvedAgentCount = resolvedQuickModeEnabled ? 1 : metadata?.agentCount;

  taskOptions['quickModeEnabled'] = resolvedQuickModeEnabled;
  if (metadata?.computerUseEnabled !== undefined) {
    taskOptions['computerUseEnabled'] = metadata.computerUseEnabled;
  }
  if (resolvedAgentCount !== undefined) {
    taskOptions['agentCount'] = resolvedAgentCount;
  }

  const clientToolsOption = buildMcpClientToolsOption(mcpToolItems);
  if (clientToolsOption) {
    taskOptions['clientTools'] = clientToolsOption.clientTools;
  }

  return {
    runPayload: buildRunPayload({ prompt, metadata, attachmentIds, taskOptions }),
    resolvedAgentCount,
  };
};

const parseRateLimitResetTime = (body: unknown): string | undefined => {
  let parsedBody: unknown = body;
  if (typeof body === 'string') {
    try {
      parsedBody = JSON.parse(body) as unknown;
    } catch {
      return undefined;
    }
  }
  if (!isRecord(parsedBody)) return undefined;
  const resetTime = parsedBody['resetTime'];
  return typeof resetTime === 'string' || typeof resetTime === 'number'
    ? String(resetTime)
    : undefined;
};

const retryRestrictionMessage = (
  metadata: SendMessageMetadata | undefined,
  runPayload: RunRequest
): string | null => {
  if (metadata?.privateChat === true) return PRIVATE_CHAT_UNSAVED_RETRY_MESSAGE;
  if (hasQueuedMcpClientTools(runPayload)) return MCP_CLIENT_TOOLS_UNSAVED_RETRY_MESSAGE;
  return null;
};

type SendFailureOptions = Pick<
  SendMessageRuntimeOptions,
  | 'ensureConversationId'
  | 'setErrorMessage'
  | 'enqueuePrompt'
  | 'invalidatePendingPrompts'
  | 'logger'
  | 'isOnline'
  | 'metadata'
> & {
  error: unknown;
  activeConversationId?: string;
  prompt: string;
  runPayload: RunRequest;
};

const recoverConversationId = async (
  activeConversationId: string | undefined,
  options: Pick<SendFailureOptions, 'ensureConversationId' | 'logger' | 'setErrorMessage'>
): Promise<string | null> => {
  if (activeConversationId) return activeConversationId;
  try {
    return await options.ensureConversationId();
  } catch (error) {
    options.logger.error('Failed to retrieve conversation during error handling', { error });
    options.setErrorMessage('Something went wrong. Please try again.');
    return null;
  }
};

const handleSendFailure = async (options: SendFailureOptions): Promise<void> => {
  const { error, metadata, prompt, runPayload, logger, setErrorMessage } = options;
  logger.error('Failed to send message', {
    error,
    modelId: metadata?.modelId,
    promptLength: prompt.length,
  });
  const conversationId = await recoverConversationId(options.activeConversationId, options);
  if (!conversationId) return;

  const restrictionMessage = retryRestrictionMessage(metadata, runPayload);
  if (error instanceof ApiClientError) {
    if (error.status === 429) {
      setErrorMessage(
        'You have reached your message limit. Please upgrade to Pro for more messages or wait for your limit to reset.',
        parseRateLimitResetTime(error.body)
      );
      return;
    }
    if (error.status < 500) {
      setErrorMessage(error.message);
      return;
    }
  }

  if (restrictionMessage) {
    setErrorMessage(restrictionMessage);
    return;
  }
  await options.enqueuePrompt(conversationId, prompt, runPayload);
  options.invalidatePendingPrompts?.();
  setErrorMessage(
    error instanceof ApiClientError
      ? 'The service is temporarily unavailable. Your prompt is saved and will retry automatically.'
      : options.isOnline === true
        ? 'We lost the connection before the response could stream. Your prompt is saved and will retry automatically.'
        : 'Network error. Prompt saved locally for retry.'
  );
};

export async function executeSendMessage({
  content,
  metadata,
  attachmentIds,
  isOnline,
  mcpToolItems: optionalMcpToolItems,
  addVisibleUserMessage,
  ensureConversationId,
  setErrorMessage,
  clearErrorMessage,
  startStreaming,
  enqueuePrompt,
  invalidatePendingPrompts,
  runTask,
  appendAssistantMessage,
  handleLocalCommand,
  handleApproval,
  logger,
}: SendMessageRuntimeOptions): Promise<void> {
  const mcpToolItems = defaultArray(optionalMcpToolItems);
  if (isOnline === false && attachmentIds && attachmentIds.length > 0) {
    setErrorMessage('Cannot send attachments while offline. Please reconnect.');
    return;
  }

  if (isOnline === false && metadata?.privateChat) {
    setErrorMessage(PRIVATE_CHAT_OFFLINE_MESSAGE);
    return;
  }

  clearErrorMessage();
  const { promptForTask, displayContent } = resolvePromptContent(content, attachmentIds);

  await addVisibleUserMessage(displayContent);

  let activeConversationId: string | undefined;
  const { runPayload, resolvedAgentCount } = buildSendMessageRunRequest({
    prompt: promptForTask,
    ...definedProps({ metadata, attachmentIds }),
    mcpToolItems,
  });

  try {
    activeConversationId = await ensureConversationId();

    const handledLocalCommand = await handleLocalCommand?.({
      prompt: promptForTask,
      ...definedProps({ attachmentIds }),
    });
    if (handledLocalCommand) {
      return;
    }

    if (isOnline === false) {
      if (hasQueuedMcpClientTools(runPayload)) {
        setErrorMessage(MCP_CLIENT_TOOLS_OFFLINE_MESSAGE);
        return;
      }
      await enqueuePrompt(activeConversationId, promptForTask, runPayload);
      invalidatePendingPrompts?.();
      setErrorMessage('Network error. Prompt saved locally for retry.');
      return;
    }

    const response = await runTask(runPayload);

    if (response.result && response.status === 'completed') {
      await appendAssistantMessage({
        conversationId: activeConversationId,
        content: response.result,
      });
      return;
    }

    if (response.task_id) {
      await startStreaming({
        taskId: response.task_id,
        conversationId: activeConversationId,
        prompt: promptForTask,
        ...definedProps({
          agentCount: resolvedAgentCount,
          computerUseEnabled: metadata?.computerUseEnabled,
          budgetLimit: metadata?.budget,
        }),
        ...(handleApproval
          ? {
              onApproval: (approval: PendingApproval | null) =>
                handleApproval(response.task_id, approval),
            }
          : {}),
      });
      return;
    }

    if (response.result) {
      await appendAssistantMessage({
        conversationId: activeConversationId,
        content: response.result,
      });
    }
  } catch (error) {
    await handleSendFailure({
      error,
      activeConversationId,
      prompt: promptForTask,
      runPayload,
      ensureConversationId,
      setErrorMessage,
      enqueuePrompt,
      invalidatePendingPrompts,
      logger,
      isOnline,
      metadata,
    });
  }
}
