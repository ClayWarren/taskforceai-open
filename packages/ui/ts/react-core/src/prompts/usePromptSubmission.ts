import {
  executePromptSubmission,
  type ExecutePromptSubmissionOptions,
} from '@taskforceai/client-runtime';
import { useRef, useState } from 'react';
import { definedProps } from '@taskforceai/client-core/utils/object';

import { logger } from '../shared/logger';

export interface UsePromptSubmissionProps<TAttachment = File> extends Omit<
  ExecutePromptSubmissionOptions<TAttachment>,
  'isOffline' | 'logger'
> {
  setErrorMessage: (message: string, resetTime?: string) => void;
  clearErrorMessage: () => void;
  resetFormState: () => void;
  allowUnauthenticatedPrompt?: (prompt: string) => boolean;
}

export function usePromptSubmission<TAttachment = File>({
  prompt,
  files,
  modelSelectorEnabled,
  selectedModelId,
  reasoningEffort,
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
  taskMode,
  privateChat,
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
    clearErrorMessage();

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
          reasoningEffort,
          budget,
          autonomyEnabled,
          taskMode,
          privateChat,
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
