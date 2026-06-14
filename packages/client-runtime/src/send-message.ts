import { ApiClientError } from '@taskforceai/contracts/client';
import type { RunRequest } from '@taskforceai/contracts/contracts';
import { buildMcpClientToolsOption, type McpRuntimeToolDescriptor } from '@taskforceai/shared';
import type { PendingApproval } from '@taskforceai/shared/types';

import type { PendingPromptRecord } from './types';

export interface SendMessageMetadata {
  modelId?: string;
  quickModeEnabled?: boolean;
  computerUseEnabled?: boolean;
  budget?: number;
  agentCount?: number;
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

export const resolvePromptContent = (content: string, attachmentIds?: string[]) => {
  const trimmed = content.trim();
  const attachmentCount = attachmentIds?.length ?? 0;
  const hasAttachments = attachmentCount > 0;
  const promptForTask =
    trimmed.length > 0 ? content : hasAttachments ? ATTACHMENT_ONLY_PROMPT : content;
  const displayContent =
    trimmed.length > 0
      ? content
      : hasAttachments
        ? `[Attached ${attachmentCount} file${attachmentCount === 1 ? '' : 's'}]`
        : content;

  return { promptForTask, displayContent };
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
    runPayload: {
      prompt,
      demo: false,
      ...(attachmentIds && attachmentIds.length ? { attachment_ids: attachmentIds } : {}),
      ...(metadata?.modelId ? { modelId: metadata.modelId } : {}),
      ...(metadata?.budget !== undefined ? { budget: metadata.budget } : {}),
      ...(Object.keys(taskOptions).length > 0 ? { options: taskOptions } : {}),
    },
    resolvedAgentCount,
  };
};

export async function executeSendMessage({
  content,
  metadata,
  attachmentIds,
  isOnline,
  mcpToolItems = [],
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
  if (isOnline === false && attachmentIds && attachmentIds.length > 0) {
    setErrorMessage('Cannot send attachments while offline. Please reconnect.');
    return;
  }

  clearErrorMessage();
  const { promptForTask, displayContent } = resolvePromptContent(content, attachmentIds);

  await addVisibleUserMessage(displayContent);

  let activeConversationId: string | undefined;
  const { runPayload, resolvedAgentCount } = buildSendMessageRunRequest({
    prompt: promptForTask,
    metadata,
    attachmentIds,
    mcpToolItems,
  });

  try {
    activeConversationId = await ensureConversationId();

    if (isOnline === false) {
      await enqueuePrompt(activeConversationId, promptForTask, runPayload);
      invalidatePendingPrompts?.();
      setErrorMessage('Network error. Prompt saved locally for retry.');
      return;
    }

    const handledLocalCommand = await handleLocalCommand?.({
      prompt: promptForTask,
      attachmentIds,
    });
    if (handledLocalCommand) {
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
        agentCount: resolvedAgentCount,
        computerUseEnabled: metadata?.computerUseEnabled,
        budgetLimit: metadata?.budget,
        onApproval: handleApproval
          ? (approval) => handleApproval(response.task_id, approval)
          : undefined,
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
    logger.error('Failed to send message', {
      error,
      modelId: metadata?.modelId,
      promptLength: promptForTask.length,
    });

    if (!activeConversationId) {
      try {
        activeConversationId = await ensureConversationId();
      } catch (convError) {
        logger.error('Failed to retrieve conversation during error handling', { error: convError });
        setErrorMessage('Something went wrong. Please try again.');
        return;
      }
    }

    if (error instanceof ApiClientError) {
      if (error.status === 429) {
        let errorBody: Record<string, unknown> = {};
        if (typeof error.body === 'object' && error.body !== null) {
          errorBody = error.body as Record<string, unknown>;
        } else if (typeof error.body === 'string') {
          try {
            errorBody = JSON.parse(error.body);
          } catch {
            // Ignore parsing errors.
          }
        }
        const rawResetTime = errorBody['resetTime'];
        const resetTime =
          typeof rawResetTime === 'string' || typeof rawResetTime === 'number'
            ? String(rawResetTime)
            : undefined;
        setErrorMessage(
          'You have reached your message limit. Please upgrade to Pro for more messages or wait for your limit to reset.',
          resetTime
        );
        return;
      }

      if (error.status >= 500) {
        setErrorMessage(
          'The service is temporarily unavailable. Your prompt is saved and will retry automatically.'
        );
        await enqueuePrompt(activeConversationId, promptForTask, runPayload);
        invalidatePendingPrompts?.();
        return;
      }

      setErrorMessage(error.message);
      return;
    }

    await enqueuePrompt(activeConversationId, promptForTask, runPayload);
    invalidatePendingPrompts?.();
    setErrorMessage(
      isOnline === true
        ? 'We lost the connection before the response could stream. Your prompt is saved and will retry automatically.'
        : 'Network error. Prompt saved locally for retry.'
    );
  }
}
