import {
  insertMcpToolCommandIntoPrompt,
  type McpRuntimeToolDescriptor,
  type PendingApproval,
  type ResearchWorkflowOption,
} from '@taskforceai/shared';
import { useFileAttachments, useVoiceControl } from '@taskforceai/react-core';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ModelSelectorResponse } from '@taskforceai/contracts/contracts';

import { logger } from '../../../lib/logger';
import { useMobileViewport } from '../../../lib/hooks/useMobileViewport';
import { useConversationStore, usePlatformRuntime } from '../../../lib/platform/PlatformProvider';
import { useAuth } from '../../../lib/providers/AuthProvider';
import { useStreaming } from '../../../lib/providers/StreamingProvider';
import { useProjects } from '../../../lib/projects/ProjectsContext';
import { useLockedComputerUseStatus } from './useLockedComputerUseStatus';
import { usePromptFormPreferences } from './usePromptFormPreferences';
import { usePromptFormViewState } from './usePromptFormViewState';
import { usePromptModeBadges } from './usePromptModeBadges';
import { usePromptModelSelector } from './usePromptModelSelector';
import { usePromptTextareaAutofocus } from './usePromptTextareaAutofocus';
import { useWebPromptSubmission } from './useWebPromptSubmission';
import {
  insertPromptTemplateIntoPrompt,
  PROMPT_TEMPLATES,
  type PromptTemplate,
} from './promptTemplates';

interface UsePromptFormControllerOptions {
  clearErrorMessage: () => void;
  ensureConversationId: () => Promise<string>;
  initialModelSelector?: ModelSelectorResponse | null;
  isDisabled: boolean;
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
  onSendMessage?: (_content: string) => void;
}

export function usePromptFormController({
  clearErrorMessage,
  ensureConversationId,
  initialModelSelector = null,
  isDisabled,
  mcpToolItems,
  promptValue,
  onPromptValueChange,
  onConversationId,
  onLocalCommand,
  onMcpApproval,
  onSendMessage,
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
  });
  const isMobileViewport = useMobileViewport();
  const { lockedComputerUseStatus, toggleLockedComputerUse } = useLockedComputerUseStatus({
    platformRuntime,
    setErrorMessage,
  });
  const attachments = useFileAttachments();

  useEffect(() => {
    if (attachments.error) {
      setErrorMessage(attachments.error);
    }
  }, [attachments.error, setErrorMessage]);

  const modelSelector = usePromptModelSelector({
    initialModelSelector,
  });

  const { isListening, handleVoiceButtonClick } = useVoiceControl({
    setErrorMessage,
    onTranscript: (text) => {
      setPrompt((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
    },
  });

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
    ensureConversationId,
    setErrorMessage,
    clearErrorMessage,
    onSendMessage,
    onConversationId,
    resetFormState,
    hasRateLimitError,
    isListening,
    computerUseEnabled: preferences.computerUseEnabled,
    useLoggedInServices: preferences.computerUseSessionMode === 'logged_in',
    quickModeEnabled: preferences.quickModeEnabled,
    role_models: preferences.customRoleModels,
    budget: preferences.budget,
    agentCount: preferences.agentCount,
    autonomyEnabled: preferences.autonomyEnabled,
    computerUseTarget,
    isAuthenticated,
    userPlan: user?.plan ?? null,
    activeProjectId,
    enqueuePrompt: (conversationId, queuedPrompt, runPayload) =>
      conversationStore.enqueuePrompt(
        conversationId,
        queuedPrompt,
        runPayload as Parameters<typeof conversationStore.enqueuePrompt>[2]
      ),
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
    isStreaming,
    isAuthenticated: isAuthenticated || isDesktopLocalSlashCommand,
    isAuthLoading,
    loginPromptText,
  });
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  usePromptTextareaAutofocus({
    controlsDisabled: viewState.controlsDisabled,
    interactionsDisabled: viewState.interactionsDisabled,
    textareaRef,
  });

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isStreaming) {
      e.preventDefault();
      return;
    }

    void handleSubmit(e);
  };

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

  const handleFormSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    if (isStreaming) {
      event.preventDefault();
      void cancelStreaming();
      return;
    }

    void handleSubmit(event);
  };

  const handleInsertMcpTool = (serverName: string, toolName: string) => {
    setPrompt((previous) =>
      insertMcpToolCommandIntoPrompt({
        prompt: previous,
        serverName,
        toolName,
      })
    );
  };

  const handleInsertPromptTemplate = (template: PromptTemplate) => {
    setSelectedResearchWorkflow(template.workflow ?? null);
    setPrompt((previous) => insertPromptTemplateIntoPrompt(previous, template));
    textareaRef.current?.focus();
  };

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
    handleKeyDown,
    handleModelSelect: modelSelector.handleModelSelect,
    handlePrimaryButtonClick,
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
    preferences,
    prompt,
    promptTemplates: PROMPT_TEMPLATES,
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
