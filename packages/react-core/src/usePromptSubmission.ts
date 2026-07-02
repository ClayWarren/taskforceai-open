import { executePromptSubmission } from '@taskforceai/client-runtime';
import { useRef, useState } from 'react';
import type { ResearchWorkflowOption } from '@taskforceai/shared';
import { definedProps } from '@taskforceai/shared/utils/object';
import type {
  ExecutePromptSubmitParams,
  SubmitStreamingPromptError,
  SubmitStreamingPromptOutcome,
} from '@taskforceai/client-runtime';
import type { Result } from '@taskforceai/shared/result';

import { logger } from './logger';

export interface UsePromptSubmissionProps<TAttachment = File> {
  prompt: string;
  files: TAttachment[];
  modelSelectorEnabled: boolean;
  selectedModelId: string | null;
  ensureConversationId: () => Promise<string>;
  setErrorMessage: (message: string, resetTime?: string) => void;
  clearErrorMessage: () => void;
  onSendMessage?: ((_content: string) => void) | undefined;
  onConversationId?: ((_conversationId: number) => void) | undefined;
  resetFormState: () => void;
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

  // Dependencies injected from the host app
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
  allowUnauthenticatedPrompt?: (prompt: string) => boolean;
}

export function usePromptSubmission<TAttachment = File>({
  prompt,
  files,
  modelSelectorEnabled,
  selectedModelId,
  ensureConversationId,
  setErrorMessage,
  clearErrorMessage,
  onSendMessage,
  onConversationId,
  resetFormState,
  hasRateLimitError,
  isListening,
  computerUseEnabled,
  useLoggedInServices,
  quickModeEnabled,
  isAuthenticated,
  userPlan,
  activeProjectId,
  role_models,
  budget,
  autonomyEnabled,
  agentCount,
  researchWorkflow,
  enqueuePrompt,
  prepareStreaming,
  failPreparedStreaming,
  startStreaming,
  submitPrompt,
  uploadAttachment,
  getRateLimitMessage,
  getRateLimitResetTime,
  allowUnauthenticatedPrompt,
}: UsePromptSubmissionProps<TAttachment>) {
  const [loading, setLoading] = useState(false);
  const isSubmittingRef = useRef(false);

  const handleSubmit = async (e?: React.SyntheticEvent) => {
    e?.preventDefault();

    const trimmedPrompt = prompt.trim();
    const canSubmitSignedOut =
      !isAuthenticated && allowUnauthenticatedPrompt?.(trimmedPrompt) === true;
    const isAuthenticatedForSubmission = isAuthenticated || canSubmitSignedOut;

    if (!isAuthenticated && !canSubmitSignedOut) {
      setTimeout(() => {
        setErrorMessage('Please sign in to start chatting.');
      }, 0);
      return;
    }

    if (hasRateLimitError || isListening) {
      return;
    }

    if (!trimmedPrompt && files.length === 0) {
      return;
    }
    if (isSubmittingRef.current) {
      return;
    }

    isSubmittingRef.current = true;
    setLoading(true);
    if (!hasRateLimitError) {
      clearErrorMessage();
    }

    try {
      const result = await executePromptSubmission({
        prompt: trimmedPrompt,
        files,
        modelSelectorEnabled,
        selectedModelId,
        userPlan,
        ensureConversationId,
        hasRateLimitError,
        isListening,
        isAuthenticated: isAuthenticatedForSubmission,
        enqueuePrompt,
        startStreaming,
        submitPrompt,
        uploadAttachment,
        getRateLimitMessage,
        getRateLimitResetTime,
        isOffline: () => typeof navigator !== 'undefined' && !navigator.onLine,
        logger,
        ...definedProps({
          role_models,
          budget,
          autonomyEnabled,
          agentCount,
          researchWorkflow,
          computerUseEnabled,
          useLoggedInServices,
          quickModeEnabled,
          onSendMessage,
          onConversationId,
          activeProjectId,
          prepareStreaming,
          failPreparedStreaming,
        }),
      });

      if (result.type === 'blocked') {
        return;
      }

      if (result.type === 'error') {
        if (result.resetTime) {
          setErrorMessage(result.message, result.resetTime);
        } else {
          setErrorMessage(result.message);
        }
        return;
      }

      if (result.type === 'queued') {
        setErrorMessage(result.message);
      }

      if (result.shouldResetForm) {
        resetFormState();
      }
    } finally {
      setLoading(false);
      isSubmittingRef.current = false;
    }
  };

  return {
    loading,
    setLoading,
    handleSubmit,
  };
}
