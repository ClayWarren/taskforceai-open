import {
  type McpRuntimeToolDescriptor,
  type PendingApproval,
  type ResearchWorkflowOption,
} from '@taskforceai/client-core';
import { transcribeDictationAudio } from '@taskforceai/client-runtime';
import { useFileAttachments, useVoiceControl } from '@taskforceai/react-core';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ModelSelectorResponse } from '@taskforceai/contracts/contracts';

import { logger } from '../../../../lib/logger';
import { useMobileViewport } from '../../../../lib/hooks/useMobileViewport';
import { createVoiceGatewayRequestOptions } from '../../../../lib/platform/desktop-api';
import {
  useConversationStore,
  usePlatformRuntime,
} from '../../../../lib/platform/PlatformProvider';
import { useAuth } from '../../../../lib/providers/AuthProvider';
import { useStreaming } from '../../../../lib/providers/StreamingProvider';
import { useProjects } from '../../../../lib/projects/ProjectsContext';
import { useLockedComputerUseStatus } from './useLockedComputerUseStatus';
import { usePromptFormPreferences } from '../orchestration/usePromptFormPreferences';
import { usePromptFormViewState } from './usePromptFormViewState';
import { usePromptModeBadges } from './usePromptModeBadges';
import { usePromptModelSelector } from '../orchestration/usePromptModelSelector';
import { useReasoningEffort } from '../orchestration/useReasoningEffort';
import { usePromptTextareaAutofocus } from './usePromptTextareaAutofocus';
import {
  useRealtimeVoiceSession,
  type RealtimeVoiceTranscriptMessage,
} from '../realtime/useRealtimeVoiceSession';
import { useWebPromptSubmission } from '../submission/useWebPromptSubmission';
import { PROMPT_TEMPLATES } from '../composer/promptTemplates';
import {
  readDesktopProjectWorkspace,
  type DesktopTaskMode,
} from '../../../../lib/desktop/task-mode';
import { createPromptContentActions } from './createPromptContentActions';
import { createPromptFormKeyDownHandler } from './createPromptFormKeyDownHandler';

interface UsePromptFormControllerOptions {
  clearErrorMessage: () => void;
  ensureConversationId: () => Promise<string>;
  initialModelSelector?: ModelSelectorResponse | null;
  isDisabled: boolean;
  persistMessages?: boolean;
  privateChat?: boolean;
  mcpToolItems: McpRuntimeToolDescriptor[];
  promptValue?: string;
  onPromptValueChange?: React.Dispatch<React.SetStateAction<string>>;
  onConversationId?: (_conversationId: number) => void;
  onLocalCommand?: (_input: {
    prompt: string;
    attachmentIds?: string[];
    computerUseEnabled?: boolean;
    computerUseTarget?: 'virtual' | 'local';
  }) => Promise<boolean>;
  onMcpApproval?: (_taskId: string, _approval: PendingApproval | null) => Promise<void>;
  onRealtimeVoiceActiveChange?: (_isActive: boolean) => void;
  onRealtimeTranscriptMessagesChange?: (_messages: RealtimeVoiceTranscriptMessage[]) => void;
  onSendMessage?: (_content: string) => void;
  desktopTaskMode?: DesktopTaskMode;
}

export function usePromptFormController({
  clearErrorMessage,
  ensureConversationId,
  initialModelSelector = null,
  isDisabled,
  persistMessages = true,
  privateChat = false,
  mcpToolItems,
  promptValue,
  onPromptValueChange,
  onConversationId,
  onLocalCommand,
  onMcpApproval,
  onRealtimeVoiceActiveChange,
  onRealtimeTranscriptMessagesChange,
  onSendMessage,
  desktopTaskMode,
}: UsePromptFormControllerOptions) {
  const { t } = useTranslation();
  const { isAuthenticated, isLoading: isAuthLoading, user } = useAuth();
  const {
    isStreaming,
    errorMessage,
    setErrorMessage,
    prepareStreaming,
    failPreparedStreaming,
    startStreaming,
    cancelStreaming,
    currentSpend,
    budgetLimit,
  } = useStreaming();
  const { activeProjectId } = useProjects();
  const conversationStore = useConversationStore();
  const platformRuntime = usePlatformRuntime();
  const [internalPrompt, setInternalPrompt] = useState('');
  const prompt = promptValue ?? internalPrompt;
  const setPrompt = onPromptValueChange ?? setInternalPrompt;
  const [selectedResearchWorkflow, setSelectedResearchWorkflow] =
    useState<ResearchWorkflowOption | null>(null);
  const [isOrchestrationModalOpen, setIsOrchestrationModalOpen] = useState(false);
  const [isAutonomousPanelOpen, setIsAutonomousPanelOpen] = useState(false);
  const [computerUseTarget, setComputerUseTarget] = useState<'virtual' | 'local'>('virtual');
  const preferences = usePromptFormPreferences({
    isAuthenticated,
    platformRuntime,
    user,
    setErrorMessage,
    desktopTaskMode,
  });
  const isMobileViewport = useMobileViewport();
  const { lockedComputerUseStatus, toggleLockedComputerUse } = useLockedComputerUseStatus({
    platformRuntime,
    setErrorMessage,
  });
  const attachments = useFileAttachments();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const modelSelectorTriggerRef = useRef<HTMLButtonElement | null>(null);
  const ensureProjectConversationId = useCallback(async () => {
    const conversationId = await ensureConversationId();
    if (!privateChat && activeProjectId !== null && conversationStore.setConversationProjectId) {
      await conversationStore.setConversationProjectId(conversationId, activeProjectId);
    }
    return conversationId;
  }, [activeProjectId, conversationStore, ensureConversationId, privateChat]);
  const desktopProjectWorkspace =
    desktopTaskMode === 'code' ? readDesktopProjectWorkspace(activeProjectId) : null;

  useEffect(() => {
    if (attachments.error) {
      setErrorMessage(attachments.error);
    }
  }, [attachments.error, setErrorMessage]);

  const modelSelector = usePromptModelSelector({
    initialModelSelector,
    userPlan: user?.plan,
  });
  const reasoningEffort = useReasoningEffort({
    modelOptions: modelSelector.filteredModelOptions,
    selectedModelId: modelSelector.effectiveModelId,
  });

  const { isListening, acceptVoiceInput, cancelVoiceInput, handleVoiceButtonClick } =
    useVoiceControl({
      setErrorMessage,
      mode: 'audio',
      onAudioCaptureFile: async (file) => {
        const text = await transcribeDictationAudio(
          file,
          await createVoiceGatewayRequestOptions(platformRuntime)
        );
        const normalizedText = text.trim();
        if (!normalizedText) {
          return;
        }
        setPrompt((prev) => (prev.trim() ? `${prev.trim()} ${normalizedText}` : normalizedText));
      },
    });
  const realtimeVoice = useRealtimeVoiceSession({
    onMessagesChange: onRealtimeTranscriptMessagesChange,
    setErrorMessage,
  });
  const realtimeVoiceAllowed = !privateChat && (!desktopTaskMode || desktopTaskMode === 'chat');
  const disconnectRealtimeVoice = realtimeVoice.disconnect;
  const realtimeVoiceIsActive = realtimeVoice.isActive;
  useEffect(() => {
    if (!realtimeVoiceAllowed && realtimeVoiceIsActive) {
      disconnectRealtimeVoice();
    }
  }, [disconnectRealtimeVoice, realtimeVoiceAllowed, realtimeVoiceIsActive]);
  useEffect(() => {
    onRealtimeVoiceActiveChange?.(realtimeVoice.isActive);
  }, [onRealtimeVoiceActiveChange, realtimeVoice.isActive]);
  const promptSubmissionBlockedByVoice = isListening || realtimeVoice.isActive;

  const hasRateLimitError = Boolean(
    errorMessage &&
    (errorMessage.toLowerCase().includes('rate limit') ||
      errorMessage.toLowerCase().includes('message limit'))
  );

  const resetFormState = () => {
    setPrompt('');
    setSelectedResearchWorkflow(null);
    attachments.clearFiles();
  };

  const toggleLocalComputerUseTarget = () => {
    if (computerUseTarget === 'local') {
      setComputerUseTarget('virtual');
      return;
    }
    if (lockedComputerUseStatus?.requiresInstall) {
      toggleLockedComputerUse();
      return;
    }
    setComputerUseTarget('local');
  };

  const { loading, handleSubmit } = useWebPromptSubmission({
    prompt,
    files: attachments.files,
    modelSelectorEnabled: modelSelector.modelSelectorEnabled,
    selectedModelId: modelSelector.effectiveModelId,
    reasoningEffort: reasoningEffort.selectedEffort ?? undefined,
    ensureConversationId: ensureProjectConversationId,
    setErrorMessage,
    clearErrorMessage,
    onSendMessage,
    onConversationId,
    resetFormState,
    hasRateLimitError,
    isListening: promptSubmissionBlockedByVoice,
    computerUseEnabled: preferences.computerUseEnabled,
    useLoggedInServices: preferences.computerUseSessionMode === 'logged_in',
    quickModeEnabled: preferences.quickModeEnabled,
    privateChat,
    role_models: preferences.customRoleModels,
    budget: preferences.budget,
    agentCount: preferences.agentCount,
    autonomyEnabled: preferences.autonomyEnabled,
    computerUseTarget,
    isAuthenticated,
    userPlan: user?.plan ?? null,
    activeProjectId,
    desktopProjectWorkspace,
    enqueuePrompt: (conversationId, queuedPrompt, runPayload) => {
      if (!persistMessages) {
        throw new Error('Private chat does not save prompts for retry.');
      }
      return conversationStore.enqueuePrompt(
        conversationId,
        queuedPrompt,
        runPayload as Parameters<typeof conversationStore.enqueuePrompt>[2]
      );
    },
    prepareStreaming,
    failPreparedStreaming,
    startStreaming,
    onLocalCommand,
    onMcpApproval,
    mcpToolItems,
    researchWorkflow: selectedResearchWorkflow ?? undefined,
  });

  const loginPromptText = t('auth.loginRequired', 'Sign in to start chatting.');
  const isDesktopLocalSlashCommand = platformRuntime === 'desktop' && prompt.trim().startsWith('/');
  const viewState = usePromptFormViewState({
    prompt,
    effectiveModelId: modelSelector.effectiveModelId,
    hasRateLimitError,
    isDisabled,
    isMobileViewport,
    loading,
    isListening,
    isRealtimeVoiceActive: realtimeVoice.isActive,
    isStreaming,
    isAuthenticated: isAuthenticated || isDesktopLocalSlashCommand,
    isAuthLoading,
    loginPromptText,
  });
  usePromptTextareaAutofocus({
    controlsDisabled: viewState.controlsDisabled,
    interactionsDisabled: viewState.interactionsDisabled,
    textareaRef,
  });

  const handleKeyDown = createPromptFormKeyDownHandler({
    connectRealtimeVoice: realtimeVoice.connect,
    handleSubmit,
    handleVoiceButtonClick,
    isAuthLoading,
    isAuthenticated,
    isInteractionsDisabled: viewState.interactionsDisabled,
    isListening,
    isLoading: loading,
    isModelSelectorDisabled: viewState.modelSelectorDisabled,
    isModelSelectorEnabled: modelSelector.modelSelectorEnabled,
    isModelSelectorLoading: modelSelector.modelSelectorLoading,
    isRealtimeVoiceActive: realtimeVoice.isActive,
    isRealtimeVoiceAllowed: realtimeVoiceAllowed,
    isStreaming,
    modelOptionCount: modelSelector.filteredModelOptions.length,
    modelSelectorTriggerRef,
    platformRuntime,
  });

  const handlePrimaryButtonClick = (event: React.MouseEvent) => {
    if (isStreaming) {
      event.preventDefault();
      void cancelStreaming();
      return;
    }

    if (viewState.primaryAction.mode === 'send') {
      void handleSubmit(event);
      return;
    }

    void handleVoiceButtonClick();
  };

  const handleRealtimeVoiceClick = () => {
    if (!realtimeVoiceAllowed) {
      return;
    }
    void realtimeVoice.connect();
  };

  const handleRealtimeVoicePrewarm = () => {
    if (!realtimeVoiceAllowed) {
      return;
    }
    realtimeVoice.prewarm();
  };

  const handleAcceptDictation = () => {
    void acceptVoiceInput();
  };

  const handleCancelDictation = () => {
    void cancelVoiceInput();
  };

  const handleFormSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    if (isStreaming) {
      event.preventDefault();
      void cancelStreaming();
      return;
    }

    void handleSubmit(event);
  };

  const {
    handleInsertMcpTool,
    handleInsertPromptTemplate,
    handleLargePaste,
    handleShowAttachmentInTextField,
  } = createPromptContentActions({
    addFile: attachments.addFile,
    files: attachments.files,
    prompt,
    removeFile: attachments.removeFile,
    setPrompt,
    setSelectedResearchWorkflow,
    textareaRef,
  });

  const modeBadges = usePromptModeBadges({
    quickModeEnabled: preferences.quickModeEnabled,
    autonomyEnabled: preferences.autonomyEnabled,
    computerUseEnabled: preferences.computerUseEnabled,
    computerUseSessionMode: preferences.computerUseSessionMode,
    customRoleModels: preferences.customRoleModels,
    isAutonomyAllowed: true,
    isComputerUseAllowed: true,
    onOpenOrchestration: () => setIsOrchestrationModalOpen(true),
    onOpenAutonomousPanel: () => setIsAutonomousPanelOpen(true),
    onSetAutonomyEnabled: preferences.setAutonomyEnabled,
    onSetComputerUseEnabled: preferences.setComputerUseEnabled,
    onSetComputerUseSessionMode: preferences.setComputerUseSessionMode,
    onSetCustomRoleModels: preferences.setCustomRoleModels,
    onSetQuickModeEnabled: preferences.setQuickModeEnabled,
  });

  return {
    attachments,
    currentSpend,
    budgetLimit,
    handleInsertMcpTool,
    handleInsertPromptTemplate,
    handleLargePaste,
    handleKeyDown,
    handleModelSelect: modelSelector.handleModelSelect,
    handleDictationButtonClick: handleVoiceButtonClick,
    handlePrimaryButtonClick,
    handleShowAttachmentInTextField,
    handleSubmit: handleFormSubmit,
    isAuthenticated,
    isAuthenticatedForChrome: isAuthenticated || isAuthLoading,
    isAutonomousPanelOpen,
    isAutonomyAllowed: true,
    isComputerUseAllowed: true,
    isListening,
    isOrchestrationModalOpen,
    isStreaming,
    loading,
    lockedComputerUseStatus,
    computerUseTarget,
    loginPromptText,
    modeBadges,
    modelSelector,
    platformRuntime,
    reasoningEffort,
    modelSelectorTriggerRef,
    preferences,
    prompt,
    promptSubmissionBlockedByVoice,
    promptTemplates: PROMPT_TEMPLATES,
    realtimeVoice,
    handleAcceptDictation,
    handleCancelDictation,
    handleRealtimeVoiceClick,
    handleRealtimeVoicePrewarm,
    selectedResearchWorkflow,
    setIsAutonomousPanelOpen,
    setIsOrchestrationModalOpen,
    setPrompt,
    textareaRef,
    toggleLockedComputerUse: toggleLocalComputerUseTarget,
    user,
    viewState,
    openOrchestrationModal: () => {
      logger.debug('Opening Orchestration Modal');
      setIsOrchestrationModalOpen(true);
    },
  };
}
