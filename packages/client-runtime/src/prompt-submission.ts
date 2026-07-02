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
import { definedProps } from '@taskforceai/shared/utils/object';

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

const NETWORK_QUEUE_MESSAGE = 'Network error. Prompt saved locally for retry.';
const STREAMING_RETRY_MESSAGE =
  'We lost the connection before the response could stream. Your prompt is saved and will retry automatically.';
const GENERIC_SEND_ERROR = 'Something went wrong while sending your message. Please try again.';

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

type PreparedStreamingPayload = Parameters<
  NonNullable<SubmitStreamingPromptParams['prepareStreaming']>
>[0];
type StartStreamingMetadata = Omit<
  Parameters<SubmitStreamingPromptParams['startStreaming']>[0],
  'taskId' | 'onApproval' | 'onConversationId'
>;

type PromptSubmissionContext = {
  conversationId: string;
  payload: RunRequest;
  streamMetadata: PreparedStreamingPayload & StartStreamingMetadata;
};

const loggedInServicesOption = (
  computerUseEnabled: boolean | undefined,
  useLoggedInServices: boolean | undefined
): true | undefined =>
  computerUseEnabled === true && useLoggedInServices === true ? true : undefined;

const buildPromptSubmissionContext = async (
  params: SubmitStreamingPromptParams
): Promise<PromptSubmissionContext> => {
  const {
    prompt,
    attachment_ids,
    modelId,
    role_models,
    projectId,
    computerUseEnabled,
    useLoggedInServices,
    quickModeEnabled,
    autonomyEnabled,
    budget,
    agentCount,
    mcpToolItems = [],
    researchWorkflow,
    ensureConversationId,
  } = params;

  const overrides = resolveRoutingOverrides({
    prompt,
    hasAttachments: (attachment_ids?.length ?? 0) > 0,
    ...definedProps({
      currentModelId: modelId,
      currentQuickMode: quickModeEnabled,
      currentComputerUse: computerUseEnabled,
    }),
  });

  const resolvedModelId = overrides.modelId;
  const resolvedQuickModeEnabled = overrides.quickModeEnabled ?? true;
  const resolvedComputerUseEnabled = overrides.computerUseEnabled;
  const resolvedAgentCount = resolvedQuickModeEnabled ? 1 : agentCount;
  const activeRoleModels = resolvedQuickModeEnabled
    ? undefined
    : filterRoleModelsForAgentCount(role_models, resolvedAgentCount);
  const agentLabels = resolvedQuickModeEnabled
    ? []
    : buildAgentLabels(resolvedAgentCount, activeRoleModels, resolvedModelId);
  const enabledLoggedInServices = loggedInServicesOption(
    resolvedComputerUseEnabled,
    useLoggedInServices
  );
  const clientToolsOption = buildMcpClientToolsOption(mcpToolItems);

  const payload: RunRequest = {
    prompt,
    demo: false,
    ...(resolvedModelId ? { modelId: resolvedModelId } : {}),
    ...(activeRoleModels ? { role_models: activeRoleModels } : {}),
    ...(projectId ? { projectId } : {}),
    ...(budget !== undefined ? { budget } : {}),
    options: {
      ...(resolvedAgentCount !== undefined ? { agentCount: resolvedAgentCount } : {}),
      ...(resolvedComputerUseEnabled !== undefined
        ? { computerUseEnabled: resolvedComputerUseEnabled }
        : {}),
      ...(enabledLoggedInServices ? { useLoggedInServices: enabledLoggedInServices } : {}),
      quickModeEnabled: resolvedQuickModeEnabled,
      ...(autonomyEnabled !== undefined ? { autonomyEnabled } : {}),
      ...(researchWorkflow ? { researchWorkflow } : {}),
      ...clientToolsOption,
    },
    ...(attachment_ids?.length ? { attachment_ids } : {}),
  };

  const streamMetadata = {
    conversationId: await ensureConversationId(),
    prompt,
    ...(resolvedAgentCount !== undefined ? { agentCount: resolvedAgentCount } : {}),
    ...(agentLabels.length > 0 ? { agentLabels } : {}),
    ...definedProps({
      computerUseEnabled: resolvedComputerUseEnabled,
      useLoggedInServices: enabledLoggedInServices,
      budgetLimit: budget,
    }),
  } satisfies PreparedStreamingPayload & StartStreamingMetadata;

  return {
    conversationId: streamMetadata.conversationId,
    payload,
    streamMetadata,
  };
};

const queuePreparedPrompt = async (
  params: Pick<SubmitStreamingPromptParams, 'enqueuePrompt' | 'failPreparedStreaming'>,
  conversationId: string,
  prompt: string,
  payload: RunRequest,
  message: string
): Promise<Result<SubmitStreamingPromptOutcome, SubmitStreamingPromptError> | null> => {
  try {
    await params.enqueuePrompt(conversationId, prompt, payload);
    params.failPreparedStreaming?.(message);
    return ok({ type: 'queued', message });
  } catch {
    return null;
  }
};

const genericSubmissionError = (
  failPreparedStreaming?: SubmitStreamingPromptParams['failPreparedStreaming']
): Result<SubmitStreamingPromptOutcome, SubmitStreamingPromptError> => {
  failPreparedStreaming?.(GENERIC_SEND_ERROR);
  return err({ kind: 'error', message: GENERIC_SEND_ERROR });
};

const handleRunTaskError = async (
  params: SubmitStreamingPromptParams,
  context: PromptSubmissionContext,
  error: unknown
): Promise<Result<SubmitStreamingPromptOutcome, SubmitStreamingPromptError>> => {
  params.logger.warn('Prompt submission failed before response', { error });
  if (params.isOffline()) {
    const queued = await queuePreparedPrompt(
      params,
      context.conversationId,
      params.prompt,
      context.payload,
      NETWORK_QUEUE_MESSAGE
    );
    if (queued) {
      return queued;
    }
  }
  return genericSubmissionError(params.failPreparedStreaming);
};

const handleRunTaskFailure = async (
  params: SubmitStreamingPromptParams,
  context: PromptSubmissionContext,
  taskError: SubmitStreamingPromptTaskError
): Promise<Result<SubmitStreamingPromptOutcome, SubmitStreamingPromptError>> => {
  if (taskError.kind === 'rate_limit') {
    const resetTime = params.readRateLimitResetTime(taskError);
    const message = params.buildRateLimitMessage(params.userPlan);
    params.failPreparedStreaming?.(message, resetTime);
    return ok({ type: 'rate_limit', message, ...(resetTime !== undefined ? { resetTime } : {}) });
  }

  if (taskError.kind === 'network' && params.isOffline()) {
    await params.enqueuePrompt(context.conversationId, params.prompt, context.payload);
    params.failPreparedStreaming?.(NETWORK_QUEUE_MESSAGE);
    return ok({ type: 'queued', message: NETWORK_QUEUE_MESSAGE });
  }

  params.failPreparedStreaming?.(taskError.message);
  return err({ kind: 'error', message: taskError.message });
};

const handleStreamingFailure = async (
  params: SubmitStreamingPromptParams,
  context: PromptSubmissionContext,
  error: unknown
): Promise<Result<SubmitStreamingPromptOutcome, SubmitStreamingPromptError>> => {
  const normalizedError = error instanceof Error ? error : new Error(String(error));
  const queueMessage =
    normalizedError.message === 'Streaming failed'
      ? STREAMING_RETRY_MESSAGE
      : params.isOffline()
        ? NETWORK_QUEUE_MESSAGE
        : null;

  if (queueMessage) {
    const queued = await queuePreparedPrompt(
      params,
      context.conversationId,
      params.prompt,
      context.payload,
      queueMessage
    );
    if (queued) {
      return queued;
    }
  }

  return genericSubmissionError(params.failPreparedStreaming);
};

export async function submitStreamingPrompt(
  params: SubmitStreamingPromptParams
): Promise<Result<SubmitStreamingPromptOutcome, SubmitStreamingPromptError>> {
  const context = await buildPromptSubmissionContext(params);
  params.onSendMessage?.(params.prompt);
  params.prepareStreaming?.(context.streamMetadata);

  let runResult: Result<RunResponse, SubmitStreamingPromptTaskError>;
  try {
    runResult = await params.runTask(context.payload);
  } catch (error) {
    return handleRunTaskError(params, context, error);
  }

  if (!runResult.ok) {
    return handleRunTaskFailure(params, context, runResult.error);
  }

  try {
    const data = runResult.value;
    await params.startStreaming({
      ...context.streamMetadata,
      taskId: data.task_id,
      ...definedProps({ onConversationId: params.onConversationId }),
      ...(params.onApproval
        ? {
            onApproval: (approval: PendingApproval | null) =>
              params.onApproval?.(data.task_id, approval),
          }
        : {}),
    });
    return ok({ type: 'streaming_started' });
  } catch (error) {
    return handleStreamingFailure(params, context, error);
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
      userPlan,
      ensureConversationId,
      enqueuePrompt,
      startStreaming: (
        streamPayload: Parameters<SubmitStreamingPromptParams['startStreaming']>[0]
      ) => startStreaming(streamPayload),
      buildRateLimitMessage: getRateLimitMessage,
      readRateLimitResetTime: getRateLimitResetTime,
      isOffline: isOffline ?? (() => false),
      ...definedProps({
        role_models,
        budget,
        autonomyEnabled,
        agentCount,
        researchWorkflow,
        projectId: activeProjectId ?? undefined,
        computerUseEnabled,
        useLoggedInServices,
        quickModeEnabled,
        prepareStreaming,
        failPreparedStreaming,
        onConversationId,
        onSendMessage,
      }),
    } satisfies ExecutePromptSubmitParams;

    const result = await submitPrompt(submitParams);

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
        ...(result.value.resetTime !== undefined
          ? { resetTime: String(result.value.resetTime) }
          : {}),
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
