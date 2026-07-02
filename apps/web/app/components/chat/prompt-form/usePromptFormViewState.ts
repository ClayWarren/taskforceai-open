import { buildPromptAttachmentAccept, resolvePromptPrimaryAction } from '@taskforceai/shared';
import { useMemo } from 'react';

interface UsePromptFormViewStateOptions {
  prompt: string;
  effectiveModelId: string | null;
  hasRateLimitError: boolean;
  isDisabled: boolean;
  isMobileViewport: boolean;
  loading: boolean;
  isListening: boolean;
  isRealtimeVoiceActive?: boolean;
  isStreaming: boolean;
  isAuthenticated: boolean;
  isAuthLoading?: boolean;
  loginPromptText: string;
}

const iconButtonBaseClass =
  'icon-circle flex h-10 w-10 items-center justify-center rounded-full p-2 transition-colors';

export function usePromptFormViewState({
  prompt,
  effectiveModelId,
  hasRateLimitError,
  isDisabled,
  isMobileViewport,
  loading,
  isListening,
  isRealtimeVoiceActive = false,
  isStreaming,
  isAuthenticated,
  isAuthLoading = false,
  loginPromptText,
}: UsePromptFormViewStateOptions) {
  return useMemo(() => {
    const interactionsDisabled = isDisabled || hasRateLimitError;
    const controlsDisabled =
      loading || interactionsDisabled || isListening || isRealtimeVoiceActive;
    const modelSelectorDisabled =
      loading || hasRateLimitError || isListening || isRealtimeVoiceActive;
    const isKnownSignedOut = !isAuthLoading && !isAuthenticated;
    const placeholderText = hasRateLimitError
      ? 'Rate limit reached - See error message above'
      : !isMobileViewport && interactionsDisabled && isKnownSignedOut
        ? loginPromptText
        : isMobileViewport
          ? 'Ask TaskForce'
          : 'How can TaskForce help?';
    const primaryAction = resolvePromptPrimaryAction({
      prompt,
      controlsDisabled,
      interactionsDisabled,
      loading,
      isListening,
      isStreaming,
      isAuthenticated: isAuthenticated || isAuthLoading,
    });
    const primaryButtonClassName =
      primaryAction.mode === 'send'
        ? `${iconButtonBaseClass} primary-send-button text-white disabled:cursor-not-allowed disabled:opacity-60`
        : primaryAction.mode === 'stop'
          ? `${iconButtonBaseClass} bg-red-500/90 text-white hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-60`
          : `${iconButtonBaseClass} text-white ${isListening ? 'is-listening' : ''}`;

    return {
      controlsDisabled,
      fileAccept: buildPromptAttachmentAccept(effectiveModelId),
      hasRateLimitError,
      iconButtonBaseClass,
      interactionsDisabled,
      isCompactForm: isMobileViewport,
      minPromptHeight: isMobileViewport ? 34 : 48,
      modelSelectorDisabled,
      placeholderText,
      primaryAction,
      primaryButtonClassName,
      shouldShowLoginNote: isKnownSignedOut && isMobileViewport,
    };
  }, [
    effectiveModelId,
    hasRateLimitError,
    isAuthLoading,
    isAuthenticated,
    isDisabled,
    isListening,
    isRealtimeVoiceActive,
    isMobileViewport,
    isStreaming,
    loading,
    loginPromptText,
    prompt,
  ]);
}
