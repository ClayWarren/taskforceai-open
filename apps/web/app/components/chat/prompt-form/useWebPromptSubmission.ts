import { err, ok } from '@taskforceai/client-core';
import { definedProps } from '@taskforceai/client-core/utils/object';
import {
  type ExecutePromptSubmitParams,
  type SubmitStreamingPromptOutcome,
  usePromptSubmission,
  type UsePromptSubmissionProps,
} from '@taskforceai/react-core';
import type { ResearchWorkflowOption } from '@taskforceai/client-core';

import { uploadAttachment } from '../../../lib/api/attachments';
import { getRateLimitMessage, getRateLimitResetTime } from '../../../lib/prompt/prompt-submission';
import { submitPrompt } from '../../../lib/prompt/submit-prompt';
import {
  getDesktopAppServerComputerUseMode,
  submitDesktopAppServerRun,
} from '../../../lib/platform/desktop/app-server';
import type { AppServerSubmitRunParams } from '../../../lib/platform/desktop/app-server-types';
import { usePlatformRuntime } from '../../../lib/platform/PlatformProvider';
import { logger } from '../../../lib/logger';
import { parseDesktopBrowserOpenTarget } from '../../../lib/mcp/local-command';

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
  options: {
    computerUseEnabled?: boolean;
    computerUseTarget?: 'virtual' | 'local';
    platformRuntime?: 'browser' | 'desktop' | 'server';
  } = {}
): boolean => {
  const normalized = prompt.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (normalized.startsWith('/')) {
    return true;
  }
  if (
    options.platformRuntime === 'desktop' &&
    (parseDesktopBrowserOpenTarget(prompt) !== null ||
      (/\b(open|show|launch|toggle)\b/.test(normalized) &&
        /\b(in-app browser|browser)\b/.test(normalized)))
  ) {
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

type DesktopRunPayload = Parameters<NonNullable<SubmitPromptParams['runTask']>>[0];

const payloadOption = (payload: DesktopRunPayload, key: string): unknown => payload.options?.[key];
const booleanPayloadOption = (payload: DesktopRunPayload, key: string): boolean | null => {
  const value = payloadOption(payload, key);
  return typeof value === 'boolean' ? value : null;
};
const numberPayloadOption = (payload: DesktopRunPayload, key: string): number | null => {
  const value = payloadOption(payload, key);
  return typeof value === 'number' ? value : null;
};

const desktopRunParams = (options: {
  payload: DesktopRunPayload;
  computerUseMode: Awaited<ReturnType<typeof getDesktopAppServerComputerUseMode>> | null;
  computerUseTarget: 'virtual' | 'local';
  mcpToolItems: NonNullable<SubmitPromptParams['mcpToolItems']>;
}): AppServerSubmitRunParams => {
  const { payload, computerUseMode, computerUseTarget, mcpToolItems } = options;
  const computerUse =
    computerUseMode?.enabled ?? booleanPayloadOption(payload, 'computerUseEnabled');
  const workflow = payloadOption(payload, 'researchWorkflow');
  return {
    prompt: payload.prompt,
    modelId: payload.modelId ?? null,
    reasoningEffort: payload.reasoningEffort ?? null,
    quickMode: booleanPayloadOption(payload, 'quickModeEnabled'),
    autonomous: booleanPayloadOption(payload, 'autonomyEnabled'),
    computerUse,
    computerUseTarget: computerUse === true ? computerUseTarget : null,
    useLoggedInServices:
      computerUse === true ? booleanPayloadOption(payload, 'useLoggedInServices') : null,
    agentCount: numberPayloadOption(payload, 'agentCount'),
    projectId: payload.projectId ?? null,
    attachmentIds: payload.attachment_ids ?? [],
    clientMcpTools: mcpToolItems,
    ...(payload.private_chat ? { privateChat: true } : {}),
    researchWorkflow:
      typeof workflow === 'object' && workflow !== null
        ? (workflow as ResearchWorkflowOption)
        : null,
  };
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
      const desktopComputerUseMode = await getDesktopAppServerComputerUseMode().catch((error) => {
        logger.warn('Failed to load desktop computer use mode for prompt submission', { error });
        return null;
      });
      const result = await submitDesktopAppServerRun(
        desktopRunParams({
          payload,
          computerUseMode: desktopComputerUseMode,
          computerUseTarget,
          mcpToolItems,
        })
      );
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
    ...(platformRuntime === 'desktop'
      ? {
          allowUnauthenticatedPrompt: (prompt: string) => prompt.trim().startsWith('/'),
        }
      : {}),
    submitPrompt: async (submitParams: ExecutePromptSubmitParams) => {
      if (
        onLocalCommand &&
        shouldAttemptLocalCommand(submitParams.prompt, {
          computerUseTarget,
          platformRuntime,
          ...definedProps({ computerUseEnabled: props.computerUseEnabled }),
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
          computerUseTarget,
          ...definedProps({
            attachmentIds: submitParams.attachment_ids,
            computerUseEnabled: props.computerUseEnabled,
          }),
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
        ...(platformRuntime === 'desktop' ? { runTask: desktopRunTask } : {}),
        ...definedProps({
          researchWorkflow,
          onApproval: onMcpApproval
            ? (taskId: string, approval: PendingApprovalType) => {
                void onMcpApproval(taskId, approval);
              }
            : undefined,
        }),
      });
    },
    uploadAttachment,
    getRateLimitMessage: getRateLimitMessage as UsePromptSubmissionProps['getRateLimitMessage'],
    getRateLimitResetTime:
      getRateLimitResetTime as UsePromptSubmissionProps['getRateLimitResetTime'],
  });
};
