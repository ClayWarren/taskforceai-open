import {
  submitStreamingPrompt,
  type SubmitStreamingPromptError as SubmitPromptError,
  type SubmitStreamingPromptOutcome as SubmitPromptOutcome,
} from '@taskforceai/client-runtime';
import type { RunRequest } from '@taskforceai/contracts/contracts';
import type { PendingApproval } from '@taskforceai/shared/types';

import { type RunTaskError, runTask } from '@taskforceai/contracts/api/tasks';
import { logger } from '../logger';
import type { McpRuntimeToolDescriptor } from '@taskforceai/shared';
import type { ResearchWorkflowOption } from '@taskforceai/shared';
import type { Result } from '@taskforceai/shared/result';

interface SubmitPromptParams {
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
  enqueuePrompt: (
    _conversationId: string,
    _prompt: string,
    _runPayload?: RunRequest
  ) => Promise<void>;
  prepareStreaming?: (_params: {
    conversationId: string;
    prompt: string;
    agentCount?: number;
    agentLabels?: string[];
    computerUseEnabled?: boolean;
    useLoggedInServices?: boolean;
    budgetLimit?: number;
  }) => void;
  failPreparedStreaming?: (_message: string, _resetTime?: string) => void;
  startStreaming: (_params: {
    taskId: string;
    conversationId: string;
    prompt: string;
    agentCount?: number;
    agentLabels?: string[];
    computerUseEnabled?: boolean;
    useLoggedInServices?: boolean;
    budgetLimit?: number;
    onConversationId?: (_conversationId: number) => void;
    onApproval?: (_approval: PendingApproval | null) => void;
  }) => Promise<void>;
  onSendMessage?: (_prompt: string) => void;
  onConversationId?: (_conversationId: number) => void;
  onApproval?: (_taskId: string, _approval: PendingApproval | null) => void;
  buildRateLimitMessage: (_plan?: string | null) => string;
  readRateLimitResetTime: (_error: RunTaskError) => string | undefined;
  isOffline: () => boolean;
  runTask?: (_payload: RunRequest) => ReturnType<typeof runTask>;
}

export type { SubmitPromptError, SubmitPromptOutcome };

export const submitPrompt = async (
  params: SubmitPromptParams
): Promise<Result<SubmitPromptOutcome, SubmitPromptError>> => {
  return submitStreamingPrompt({
    ...params,
    runTask: (payload: RunRequest) => (params.runTask ?? runTask)(payload),
    readRateLimitResetTime: (error) =>
      error.kind === 'rate_limit'
        ? params.readRateLimitResetTime({
            kind: 'rate_limit',
            message: error.message,
            ...(error.status !== undefined ? { status: error.status } : {}),
            ...(error.resetTime !== undefined ? { resetTime: error.resetTime } : {}),
          })
        : undefined,
    logger,
  });
};
