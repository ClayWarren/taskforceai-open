import type React from 'react';

import type { PlatformRuntime } from '../../../../lib/platform/platform-interfaces';

interface CreatePromptFormKeyDownHandlerOptions {
  connectRealtimeVoice: () => void | Promise<void>;
  handleSubmit: (event: React.KeyboardEvent) => void | Promise<unknown>;
  handleVoiceButtonClick: () => void | Promise<void>;
  isAuthLoading: boolean;
  isAuthenticated: boolean;
  isInteractionsDisabled: boolean;
  isListening: boolean;
  isLoading: boolean;
  isModelSelectorDisabled: boolean;
  isModelSelectorEnabled: boolean;
  isModelSelectorLoading: boolean;
  isRealtimeVoiceActive: boolean;
  isRealtimeVoiceAllowed: boolean;
  isStreaming: boolean;
  modelOptionCount: number;
  modelSelectorTriggerRef: React.RefObject<HTMLButtonElement | null>;
  platformRuntime: PlatformRuntime;
}

const isPromptShortcut = (event: React.KeyboardEvent): boolean =>
  event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey;

const matchesKey = (key: string, code: string, expectedKey: string): boolean =>
  key === expectedKey || code === `key${expectedKey}`;

export const createPromptFormKeyDownHandler = ({
  connectRealtimeVoice,
  handleSubmit,
  handleVoiceButtonClick,
  isAuthLoading,
  isAuthenticated,
  isInteractionsDisabled,
  isListening,
  isLoading,
  isModelSelectorDisabled,
  isModelSelectorEnabled,
  isModelSelectorLoading,
  isRealtimeVoiceActive,
  isRealtimeVoiceAllowed,
  isStreaming,
  modelOptionCount,
  modelSelectorTriggerRef,
  platformRuntime,
}: CreatePromptFormKeyDownHandlerOptions) => {
  const handleDictationShortcut = (event: React.KeyboardEvent, key: string, code: string) => {
    const desktopShortcut =
      platformRuntime === 'desktop' &&
      event.ctrlKey &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.altKey &&
      matchesKey(key, code, 'm');
    if (!desktopShortcut && !(isPromptShortcut(event) && matchesKey(key, code, 'd'))) {
      return false;
    }

    event.preventDefault();
    const canStart =
      !isInteractionsDisabled &&
      !isLoading &&
      !isStreaming &&
      !isListening &&
      !isRealtimeVoiceActive;
    if (canStart) {
      void handleVoiceButtonClick();
    }
    return true;
  };

  const handleVoiceShortcut = (event: React.KeyboardEvent, key: string, code: string) => {
    if (!isPromptShortcut(event) || !matchesKey(key, code, 'v')) {
      return false;
    }

    event.preventDefault();
    const canToggle =
      isRealtimeVoiceActive ||
      (isRealtimeVoiceAllowed &&
        (isAuthenticated || isAuthLoading) &&
        !isInteractionsDisabled &&
        !isLoading &&
        !isStreaming &&
        !isListening);
    if (canToggle) {
      void connectRealtimeVoice();
    }
    return true;
  };

  const handleModelShortcut = (event: React.KeyboardEvent, key: string, code: string) => {
    if (!isPromptShortcut(event) || !matchesKey(key, code, 'm')) {
      return false;
    }

    event.preventDefault();
    const canOpen =
      isModelSelectorEnabled &&
      modelOptionCount > 0 &&
      !isModelSelectorLoading &&
      !isModelSelectorDisabled;
    if (canOpen) {
      modelSelectorTriggerRef.current?.click();
    }
    return true;
  };

  return (event: React.KeyboardEvent) => {
    const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
    const code = typeof event.code === 'string' ? event.code.toLowerCase() : '';
    if (handleDictationShortcut(event, key, code)) return;
    if (handleVoiceShortcut(event, key, code)) return;
    if (handleModelShortcut(event, key, code)) return;

    if (event.key !== 'Enter' || event.shiftKey) {
      return;
    }

    event.preventDefault();
    if (!isStreaming) {
      void handleSubmit(event);
    }
  };
};
