import type { RunRequest, RunResponse } from '@taskforceai/contracts/contracts';
import {
  buildMcpClientToolsOption,
  getAgentRoleSlots,
  resolveRoutingOverrides,
  type McpRuntimeToolDescriptor,
  type ResearchWorkflowOption,
} from '@taskforceai/shared';
import { err, ok, type Result } from '@taskforceai/shared/result';
import type { PendingApproval } from '@taskforceai/shared/types';

export interface PromptSubmissionLogger {
  error: (message: string, metadata?: unknown) => void;
}

export type SubmitStreamingPromptOutcome =
  | { type: 'streaming_started' }
  | { type: 'queued'; message: string }
  | { type: 'rate_limit'; message: string; resetTime?: string };

export type SubmitStreamingPromptError = {
  kind: 'error';
  message: string;
};

export interface SubmitStreamingPromptTaskError {
  kind: 'rate_limit' | 'unauthorized' | 'server' | 'network' | 'not_found';
  message: string;
  status?: number;
  resetTime?: string;
}

export interface SubmitStreamingPromptParams {
  prompt: string;
  attachment_ids?: string[];
  modelId?: string | null;
  role_models?: Record<string, string>;
  projectId?: number;
  userPlan?: string | null;
  computerUseEnabled?: boolean;
  useLoggedInServices?: boolean;
  quickModeEnabled?: boolean;
  autonomyEnabled?: boolean;
  budget?: number;
  agentCount?: number;
  mcpToolItems?: McpRuntimeToolDescriptor[];
  researchWorkflow?: ResearchWorkflowOption;
  ensureConversationId: () => Promise<string>;
  enqueuePrompt: (conversationId: string, prompt: string, runPayload?: RunRequest) => Promise<void>;
  prepareStreaming?: (params: {
    conversationId: string;
    prompt: string;
    agentCount?: number;
    agentLabels?: string[];
    computerUseEnabled?: boolean;
    useLoggedInServices?: boolean;
    budgetLimit?: number;
  }) => void;
  failPreparedStreaming?: (message: string, resetTime?: string) => void;
  startStreaming: (params: {
    taskId: string;
    conversationId: string;
    prompt: string;
    agentCount?: number;
    agentLabels?: string[];
    computerUseEnabled?: boolean;
    useLoggedInServices?: boolean;
    budgetLimit?: number;
    onConversationId?: (conversationId: number) => void;
    onApproval?: (approval: PendingApproval | null) => void;
  }) => Promise<void>;
  onSendMessage?: (prompt: string) => void;
  onConversationId?: (conversationId: number) => void;
  onApproval?: (taskId: string, approval: PendingApproval | null) => void;
  buildRateLimitMessage: (plan?: string | null) => string;
  readRateLimitResetTime: (error: SubmitStreamingPromptTaskError) => string | undefined;
  isOffline: () => boolean;
  runTask: (payload: RunRequest) => Promise<Result<RunResponse, SubmitStreamingPromptTaskError>>;
  logger: {
    warn: (message: string, metadata?: unknown) => void;
  };
}

export type ExecutePromptSubmitParams = Omit<SubmitStreamingPromptParams, 'runTask' | 'logger'>;

export interface ExecutePromptSubmissionOptions<TAttachment = File> {
  prompt: string;
  files: TAttachment[];
  modelSelectorEnabled: boolean;
  selectedModelId: string | null;
  ensureConversationId: () => Promise<string>;
  onSendMessage?: ((_content: string) => void) | undefined;
  onConversationId?: ((_conversationId: number) => void) | undefined;
  hasRateLimitError: boolean;
  isListening: boolean;
  computerUseEnabled?: boolean;
  useLoggedInServices?: boolean;
  quickModeEnabled?: boolean;
  role_models?: Record<string, string>;
  budget?: number;
  autonomyEnabled?: boolean;
  agentCount?: number;
  researchWorkflow?: ResearchWorkflowOption;
  isAuthenticated: boolean;
  userPlan: string | null;
  activeProjectId?: number | null;
  enqueuePrompt: (
    conversationId: string,
    promptValue: string,
    runPayload?: unknown
  ) => Promise<void>;
  prepareStreaming?: (payload: {
    conversationId: string;
    prompt: string;
    agentCount?: number;
    agentLabels?: string[];
    computerUseEnabled?: boolean;
    useLoggedInServices?: boolean;
    budgetLimit?: number;
  }) => void;
  failPreparedStreaming?: (message: string, resetTime?: string) => void;
  startStreaming: (payload: {
    taskId: string;
    conversationId: string;
    prompt: string;
    agentCount?: number;
    agentLabels?: string[];
    computerUseEnabled?: boolean;
    useLoggedInServices?: boolean;
    budgetLimit?: number;
    onConversationId?: (_conversationId: number) => void;
  }) => Promise<void>;
  submitPrompt: (
    params: ExecutePromptSubmitParams
  ) => Promise<Result<SubmitStreamingPromptOutcome, SubmitStreamingPromptError>>;
  uploadAttachment: (file: TAttachment) => Promise<string>;
  getRateLimitMessage: (error: unknown) => string;
  getRateLimitResetTime: (error: unknown) => string | undefined;
  isOffline?: () => boolean;
  logger: PromptSubmissionLogger;
}

export type PromptSubmissionExecutionResult =
  | { type: 'blocked' }
  | { type: 'error'; message: string; resetTime?: string }
  | { type: 'queued'; message: string; shouldResetForm: true }
  | { type: 'submitted'; shouldResetForm: true };

const queueOfflinePrompt = async (
  params: Pick<SubmitStreamingPromptParams, 'enqueuePrompt' | 'ensureConversationId'>,
  prompt: string,
  runPayload: RunRequest
): Promise<string> => {
  const conversationId = await params.ensureConversationId();
  await params.enqueuePrompt(conversationId, prompt, runPayload);
  return conversationId;
};

const buildAgentLabels = (
  agentCount: number | undefined,
  roleModels: Record<string, string> | undefined,
  fallbackModelId: string | null | undefined
): string[] => {
  if (!agentCount || agentCount <= 0) {
    return [];
  }

  const roleSlots = getAgentRoleSlots(agentCount);
  const labels = roleSlots
    .map((role) => roleModels?.[role.id])
    .filter((modelId): modelId is string => Boolean(modelId));
  const fallback = fallbackModelId?.trim();
  if (fallback) {
    while (labels.length < agentCount) {
      labels.push(fallback);
    }
  }

  return labels.slice(0, agentCount);
};

const filterRoleModelsForAgentCount = (
  roleModels: Record<string, string> | undefined,
  agentCount: number | undefined
): Record<string, string> | undefined => {
  if (!roleModels) {
    return undefined;
  }

  if (!agentCount || agentCount <= 0) {
    return roleModels;
  }

  const filteredEntries = getAgentRoleSlots(agentCount)
    .map((role) => [role.id, roleModels[role.id]] as const)
    .filter((entry): entry is readonly [string, string] => Boolean(entry[1]));

  if (filteredEntries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(filteredEntries);
};

export async function submitStreamingPrompt(
  params: SubmitStreamingPromptParams
): Promise<Result<SubmitStreamingPromptOutcome, SubmitStreamingPromptError>> {
  const {
    prompt,
    attachment_ids,
    modelId,
    role_models,
    projectId,
    userPlan,
    computerUseEnabled,
    useLoggedInServices,
    quickModeEnabled,
    autonomyEnabled,
    budget,
    agentCount,
    mcpToolItems = [],
    researchWorkflow,
    ensureConversationId,
    enqueuePrompt,
    prepareStreaming,
    failPreparedStreaming,
    startStreaming,
    onSendMessage,
    onApproval,
    buildRateLimitMessage,
    readRateLimitResetTime,
    isOffline,
    runTask,
    logger,
  } = params;

  const hasAttachments = (attachment_ids?.length ?? 0) > 0;
  const overrides = resolveRoutingOverrides({
    prompt,
    hasAttachments,
    currentModelId: modelId,
    currentQuickMode: quickModeEnabled,
    currentComputerUse: computerUseEnabled,
  });

  const resolvedModelId = overrides.modelId;
  const resolvedQuickModeEnabled = overrides.quickModeEnabled ?? true;
  const resolvedComputerUseEnabled = overrides.computerUseEnabled;
  const resolvedAgentCount = resolvedQuickModeEnabled ? 1 : agentCount;
  const activeRoleModels = filterRoleModelsForAgentCount(role_models, resolvedAgentCount);
  const agentLabels = !resolvedQuickModeEnabled
    ? buildAgentLabels(resolvedAgentCount, activeRoleModels, resolvedModelId)
    : [];

  const activeConversationId = await ensureConversationId();
  onSendMessage?.(prompt);

  const payload: RunRequest = { prompt, demo: false };
  if (resolvedModelId) {
    payload.modelId = resolvedModelId;
  }
  if (activeRoleModels) {
    payload.role_models = activeRoleModels;
  }
  if (projectId) {
    payload.projectId = projectId;
  }
  if (budget !== undefined) {
    payload.budget = budget;
  }
  if (resolvedAgentCount !== undefined) {
    payload.options = { ...payload.options, agentCount: resolvedAgentCount };
  }
  if (resolvedComputerUseEnabled !== undefined) {
    payload.options = { ...payload.options, computerUseEnabled: resolvedComputerUseEnabled };
  }
  if (resolvedComputerUseEnabled === true && useLoggedInServices === true) {
    payload.options = { ...payload.options, useLoggedInServices: true };
  }
  if (resolvedQuickModeEnabled !== undefined) {
    payload.options = { ...payload.options, quickModeEnabled: resolvedQuickModeEnabled };
  }
  if (autonomyEnabled !== undefined) {
    payload.options = { ...payload.options, autonomyEnabled };
  }
  if (researchWorkflow) {
    payload.options = { ...payload.options, researchWorkflow };
  }
  const clientToolsOption = buildMcpClientToolsOption(mcpToolItems);
  if (clientToolsOption) {
    payload.options = {
      ...payload.options,
      ...clientToolsOption,
    };
  }
  if (attachment_ids?.length) {
    payload.attachment_ids = attachment_ids;
  }

  prepareStreaming?.({
    conversationId: activeConversationId,
    prompt,
    agentCount: resolvedAgentCount,
    ...(agentLabels.length > 0 ? { agentLabels } : {}),
    computerUseEnabled: resolvedComputerUseEnabled,
    useLoggedInServices:
      resolvedComputerUseEnabled === true && useLoggedInServices === true ? true : undefined,
    budgetLimit: budget,
  });

  let runResult: Result<RunResponse, SubmitStreamingPromptTaskError>;
  try {
    runResult = await runTask(payload);
  } catch (error) {
    logger.warn('Prompt submission failed before response', { error });
    if (isOffline()) {
      try {
        await enqueuePrompt(activeConversationId, prompt, payload);
        failPreparedStreaming?.('Network error. Prompt saved locally for retry.');
        return ok({
          type: 'queued',
          message: 'Network error. Prompt saved locally for retry.',
        });
      } catch {
        // Storage failed; fall through to generic error.
      }
    }
    failPreparedStreaming?.('Something went wrong while sending your message. Please try again.');
    return err({
      kind: 'error',
      message: 'Something went wrong while sending your message. Please try again.',
    });
  }

  if (!runResult.ok) {
    if (runResult.error.kind === 'rate_limit') {
      const resetTime = readRateLimitResetTime(runResult.error);
      failPreparedStreaming?.(buildRateLimitMessage(userPlan), resetTime);
      return ok({
        type: 'rate_limit',
        message: buildRateLimitMessage(userPlan),
        ...(resetTime !== undefined ? { resetTime } : {}),
      });
    }

    if (runResult.error.kind === 'network' && isOffline()) {
      await enqueuePrompt(activeConversationId, prompt, payload);
      failPreparedStreaming?.('Network error. Prompt saved locally for retry.');
      return ok({
        type: 'queued',
        message: 'Network error. Prompt saved locally for retry.',
      });
    }

    failPreparedStreaming?.(runResult.error.message);
    return err({ kind: 'error', message: runResult.error.message });
  }

  try {
    const data = runResult.value;
    await startStreaming({
      taskId: data.task_id,
      conversationId: activeConversationId,
      prompt,
      agentCount: resolvedAgentCount,
      ...(agentLabels.length > 0 ? { agentLabels } : {}),
      computerUseEnabled: resolvedComputerUseEnabled,
      useLoggedInServices:
        resolvedComputerUseEnabled === true && useLoggedInServices === true ? true : undefined,
      budgetLimit: budget,
      onConversationId: params.onConversationId,
      onApproval: onApproval ? (approval) => onApproval(data.task_id, approval) : undefined,
    });
    return ok({ type: 'streaming_started' });
  } catch (error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    const isStreamingFailure = normalizedError.message === 'Streaming failed';
    const deviceOffline = isOffline();

    if (isStreamingFailure || deviceOffline) {
      try {
        await queueOfflinePrompt({ ensureConversationId, enqueuePrompt }, prompt, payload);
        failPreparedStreaming?.(
          isStreamingFailure
            ? 'We lost the connection before the response could stream. Your prompt is saved and will retry automatically.'
            : 'Network error. Prompt saved locally for retry.'
        );
        return ok({
          type: 'queued',
          message: isStreamingFailure
            ? 'We lost the connection before the response could stream. Your prompt is saved and will retry automatically.'
            : 'Network error. Prompt saved locally for retry.',
        });
      } catch {
        // Storage failed; fall through.
      }
    }

    failPreparedStreaming?.('Something went wrong while sending your message. Please try again.');
    return err({
      kind: 'error',
      message: 'Something went wrong while sending your message. Please try again.',
    });
  }
}

export async function executePromptSubmission<TAttachment = File>({
  prompt,
  files,
  modelSelectorEnabled,
  selectedModelId,
  ensureConversationId,
  onSendMessage,
  onConversationId,
  hasRateLimitError,
  isListening,
  computerUseEnabled,
  useLoggedInServices,
  quickModeEnabled,
  role_models,
  budget,
  autonomyEnabled,
  agentCount,
  researchWorkflow,
  isAuthenticated,
  userPlan,
  activeProjectId,
  enqueuePrompt,
  prepareStreaming,
  failPreparedStreaming,
  startStreaming,
  submitPrompt,
  uploadAttachment,
  getRateLimitMessage,
  getRateLimitResetTime,
  isOffline,
  logger,
}: ExecutePromptSubmissionOptions<TAttachment>): Promise<PromptSubmissionExecutionResult> {
  if (!isAuthenticated) {
    return {
      type: 'error',
      message: 'Please sign in to start chatting.',
    };
  }

  if (hasRateLimitError || isListening) {
    return { type: 'blocked' };
  }

  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt && files.length === 0) {
    return { type: 'blocked' };
  }

  try {
    const attachment_ids = await Promise.all(
      files.map(async (file) => {
        try {
          return await uploadAttachment(file);
        } catch (uploadErr) {
          const fileName = (file as { name?: string }).name || 'unknown file';
          logger.error('Failed to upload attachment', { error: uploadErr, fileName });
          throw new Error(`Failed to upload ${fileName}. Please try again.`, {
            cause: uploadErr,
          });
        }
      })
    );

    const submitParams = {
      prompt: trimmedPrompt,
      attachment_ids,
      modelId: modelSelectorEnabled ? selectedModelId : null,
      role_models,
      budget,
      autonomyEnabled,
      agentCount,
      researchWorkflow,
      projectId: activeProjectId ?? undefined,
      userPlan,
      computerUseEnabled,
      useLoggedInServices,
      quickModeEnabled,
      ensureConversationId,
      enqueuePrompt,
      prepareStreaming,
      failPreparedStreaming,
      startStreaming: (streamPayload: Parameters<typeof startStreaming>[0]) =>
        startStreaming(streamPayload),
      onConversationId,
      buildRateLimitMessage: getRateLimitMessage,
      readRateLimitResetTime: getRateLimitResetTime,
      isOffline: isOffline ?? (() => false),
    };

    const result = await submitPrompt(
      onSendMessage ? { ...submitParams, onSendMessage } : submitParams
    );

    if (!result.ok) {
      return {
        type: 'error',
        message: result.error.message,
      };
    }

    if (result.value.type === 'rate_limit') {
      return {
        type: 'error',
        message: result.value.message,
        resetTime: result.value.resetTime ? String(result.value.resetTime) : undefined,
      };
    }

    if (result.value.type === 'queued') {
      return {
        type: 'queued',
        message: result.value.message,
        shouldResetForm: true,
      };
    }

    return {
      type: 'submitted',
      shouldResetForm: true,
    };
  } catch (error: unknown) {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to submit prompt', { error: normalizedError });
    return {
      type: 'error',
      message: 'Something went wrong while sending your message. Please try again.',
    };
  }
}
