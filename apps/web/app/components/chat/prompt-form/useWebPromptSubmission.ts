import { err, ok } from '@taskforceai/shared';
import {
  type ExecutePromptSubmitParams,
  type SubmitStreamingPromptOutcome,
  usePromptSubmission,
  type UsePromptSubmissionProps,
} from '@taskforceai/react-core';
import type { ResearchWorkflowOption } from '@taskforceai/shared';

import { uploadAttachment } from '@taskforceai/contracts/api/tasks';
import { getRateLimitMessage, getRateLimitResetTime } from '../../../lib/prompt/prompt-submission';
import { submitPrompt } from '../../../lib/prompt/submit-prompt';
import {
  getDesktopAppServerComputerUseMode,
  submitDesktopAppServerRun,
} from '../../../lib/platform/desktop/app-server';
import type { AppServerSubmitRunParams } from '../../../lib/platform/desktop/app-server-types';
import { usePlatformRuntime } from '../../../lib/platform/PlatformProvider';

type SubmitPromptParams = Parameters<typeof submitPrompt>[0];

type PendingApprovalType = SubmitPromptParams extends {
  onApproval?: (_taskId: string, _approval: infer TApproval) => void;
}
  ? TApproval
  : never;

const localCommandErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim()) {
    return error;
  }
  try {
    const serialized = JSON.stringify(error);
    if (serialized && serialized !== '{}') {
      return serialized;
    }
  } catch {
    // Fall through to the generic message.
  }
  return 'Failed to execute local command';
};

const shouldAttemptLocalCommand = (
  prompt: string,
  options: { computerUseEnabled?: boolean; computerUseTarget?: 'virtual' | 'local' } = {}
): boolean => {
  const normalized = prompt.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (normalized.startsWith('/')) {
    return true;
  }
  if (options.computerUseEnabled !== true || options.computerUseTarget !== 'local') {
    return false;
  }
  const explicitlyLocalComputer =
    normalized.includes('local computer use') ||
    normalized.includes('local computer') ||
    normalized.includes('my screen') ||
    normalized.includes('this screen');
  const asksForComputerObservation =
    normalized.includes('screenshot') ||
    normalized.includes('screen') ||
    normalized.includes('observe') ||
    normalized.includes('look') ||
    normalized.includes('cursor') ||
    normalized.includes('mouse') ||
    normalized.includes('wait');
  return explicitlyLocalComputer && asksForComputerObservation;
};

const waitForSubmittedPromptRender = () =>
  new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, 120);
  });

type UseWebPromptSubmissionParams = Omit<
  UsePromptSubmissionProps,
  'submitPrompt' | 'uploadAttachment' | 'getRateLimitMessage' | 'getRateLimitResetTime'
> & {
  computerUseTarget?: 'virtual' | 'local';
  onLocalCommand?: (_input: {
    prompt: string;
    attachmentIds?: string[];
    computerUseEnabled?: boolean;
    computerUseTarget?: 'virtual' | 'local';
  }) => Promise<boolean>;
  onMcpApproval?: (_taskId: string, _approval: PendingApprovalType) => Promise<void>;
  mcpToolItems?: SubmitPromptParams['mcpToolItems'];
  researchWorkflow?: ResearchWorkflowOption;
};

export const useWebPromptSubmission = ({
  computerUseTarget = 'virtual',
  onLocalCommand,
  onMcpApproval,
  mcpToolItems = [],
  researchWorkflow,
  ...props
}: UseWebPromptSubmissionParams) => {
  const platformRuntime = usePlatformRuntime();
  const desktopRunTask: SubmitPromptParams['runTask'] = async (payload) => {
    try {
      const desktopComputerUseMode = await getDesktopAppServerComputerUseMode().catch(() => null);
      const payloadComputerUse =
        typeof payload.options?.['computerUseEnabled'] === 'boolean'
          ? payload.options['computerUseEnabled']
          : null;
      const computerUse = desktopComputerUseMode?.enabled ?? payloadComputerUse;
      const desktopRunParams: AppServerSubmitRunParams = {
        prompt: payload.prompt,
        modelId: payload.modelId ?? null,
        quickMode:
          typeof payload.options?.['quickModeEnabled'] === 'boolean'
            ? payload.options['quickModeEnabled']
            : null,
        autonomous:
          typeof payload.options?.['autonomyEnabled'] === 'boolean'
            ? payload.options['autonomyEnabled']
            : null,
        computerUse,
        computerUseTarget: computerUse === true ? computerUseTarget : null,
        useLoggedInServices:
          computerUse === true && typeof payload.options?.['useLoggedInServices'] === 'boolean'
            ? payload.options['useLoggedInServices']
            : null,
        agentCount:
          typeof payload.options?.['agentCount'] === 'number'
            ? payload.options['agentCount']
            : null,
        projectId: payload.projectId ?? null,
        attachmentIds: payload.attachment_ids ?? [],
        clientMcpTools: [],
        researchWorkflow:
          typeof payload.options?.['researchWorkflow'] === 'object' &&
          payload.options['researchWorkflow'] !== null
            ? (payload.options['researchWorkflow'] as ResearchWorkflowOption)
            : null,
      };
      const result = await submitDesktopAppServerRun(desktopRunParams);
      return ok({ task_id: result.run.id, status: result.run.status });
    } catch (error) {
      return {
        ok: false,
        error: {
          kind: 'network',
          message: error instanceof Error ? error.message : 'Failed to run task',
        },
      };
    }
  };

  return usePromptSubmission({
    ...props,
    allowUnauthenticatedPrompt:
      platformRuntime === 'desktop' ? (prompt) => prompt.trim().startsWith('/') : undefined,
    submitPrompt: async (submitParams: ExecutePromptSubmitParams) => {
      if (
        onLocalCommand &&
        shouldAttemptLocalCommand(submitParams.prompt, {
          computerUseEnabled: props.computerUseEnabled,
          computerUseTarget,
        })
      ) {
        const ensureSubmittedConversation =
          submitParams.ensureConversationId ?? props.ensureConversationId;
        if (typeof ensureSubmittedConversation === 'function') {
          await ensureSubmittedConversation();
        }
        (submitParams.onSendMessage ?? props.onSendMessage)?.(submitParams.prompt);
        props.resetFormState?.();
        await waitForSubmittedPromptRender();
        const handled = await onLocalCommand({
          prompt: submitParams.prompt,
          attachmentIds: submitParams.attachment_ids,
          computerUseEnabled: props.computerUseEnabled,
          computerUseTarget,
        }).catch((error: unknown) =>
          err({
            kind: 'error' as const,
            message: localCommandErrorMessage(error),
          })
        );
        if (typeof handled === 'object' && handled !== null && 'ok' in handled && !handled.ok) {
          return handled;
        }
        if (handled === true) {
          return ok<SubmitStreamingPromptOutcome>({
            type: 'streaming_started',
          });
        }
      }

      return submitPrompt({
        ...submitParams,
        mcpToolItems,
        researchWorkflow,
        ...(platformRuntime === 'desktop' ? { runTask: desktopRunTask } : {}),
        onApproval: onMcpApproval
          ? (taskId, approval) => {
              void onMcpApproval(taskId, approval);
            }
          : undefined,
      });
    },
    uploadAttachment,
    getRateLimitMessage: getRateLimitMessage as UsePromptSubmissionProps['getRateLimitMessage'],
    getRateLimitResetTime:
      getRateLimitResetTime as UsePromptSubmissionProps['getRateLimitResetTime'],
  });
};
