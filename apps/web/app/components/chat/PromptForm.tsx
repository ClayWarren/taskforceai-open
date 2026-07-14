'use client';

import type { ModelSelectorResponse } from '@taskforceai/contracts/contracts';
import { type McpRuntimeToolDescriptor, type PendingApproval } from '@taskforceai/client-core';
import React from 'react';

import {
  PromptComposerForm,
  PromptFormFooter,
  PromptFormHeader,
  RealtimeVoiceSessionPanel,
  type RealtimeVoiceTranscriptMessage,
  usePromptFormController,
} from './prompt-form';
import type { DesktopTaskMode } from '../../lib/desktop/task-mode';

interface PromptFormProps {
  onSendMessage?: (_content: string) => void;
  onLocalCommand?: (_input: {
    prompt: string;
    attachmentIds?: string[];
    computerUseEnabled?: boolean;
    computerUseTarget?: 'virtual' | 'local';
  }) => Promise<boolean>;
  onMcpApproval?: (_taskId: string, _approval: PendingApproval | null) => Promise<void>;
  mcpToolSummary?: string | null;
  mcpToolItems?: McpRuntimeToolDescriptor[];
  showMcpToolCatalog?: boolean;
  onConversationId?: (_conversationId: number) => void;
  clearErrorMessage: () => void;
  variant?: 'centered' | 'bottom';
  isDisabled?: boolean;
  persistMessages?: boolean;
  privateChat?: boolean;
  ensureConversationId: () => Promise<string>;
  initialModelSelector?: ModelSelectorResponse | null;
  promptValue?: string;
  onPromptValueChange?: React.Dispatch<React.SetStateAction<string>>;
  onRealtimeVoiceActiveChange?: (_isActive: boolean) => void;
  onRealtimeTranscriptMessagesChange?: (_messages: RealtimeVoiceTranscriptMessage[]) => void;
  desktopTaskMode?: DesktopTaskMode;
}

const defaultValue = <T,>(value: T | null | undefined, fallback: T): T => value ?? fallback;

const resolveTaskModePromptView = (args: {
  desktopTaskMode?: DesktopTaskMode;
  defaultMinPromptHeight: number;
  defaultPlaceholderText: string;
  privateChat: boolean;
  variant: 'centered' | 'bottom';
}) => {
  const workMode = args.desktopTaskMode === 'work';
  const centeredWorkMode = workMode && args.variant === 'centered';
  return {
    centeredWorkMode,
    minPromptHeight: centeredWorkMode ? 104 : args.defaultMinPromptHeight,
    placeholderText: workMode ? 'Work on anything' : args.defaultPlaceholderText,
    showRealtimeVoice:
      !args.privateChat && (!args.desktopTaskMode || args.desktopTaskMode === 'chat'),
    wrapperModeClass: workMode ? 'work-mode' : '',
  };
};

const PromptForm: React.FC<PromptFormProps> = ({
  onSendMessage,
  onLocalCommand,
  onMcpApproval,
  mcpToolSummary: mcpToolSummaryValue,
  mcpToolItems: mcpToolItemsValue,
  showMcpToolCatalog: showMcpToolCatalogValue,
  onConversationId,
  clearErrorMessage,
  variant: variantValue,
  isDisabled: isDisabledValue,
  persistMessages: persistMessagesValue,
  privateChat: privateChatValue,
  ensureConversationId,
  initialModelSelector: initialModelSelectorValue,
  promptValue,
  onPromptValueChange,
  onRealtimeVoiceActiveChange,
  onRealtimeTranscriptMessagesChange,
  desktopTaskMode,
}) => {
  const mcpToolSummary = defaultValue(mcpToolSummaryValue, null);
  const mcpToolItems = defaultValue(mcpToolItemsValue, []);
  const showMcpToolCatalog = defaultValue(showMcpToolCatalogValue, false);
  const variant = defaultValue(variantValue, 'bottom');
  const isDisabled = defaultValue(isDisabledValue, false);
  const persistMessages = defaultValue(persistMessagesValue, true);
  const privateChat = defaultValue(privateChatValue, false);
  const initialModelSelector = defaultValue(initialModelSelectorValue, null);
  const {
    attachments,
    budgetLimit,
    currentSpend,
    handleInsertMcpTool,
    handleInsertPromptTemplate,
    handleLargePaste,
    handleKeyDown,
    handleModelSelect,
    handleDictationButtonClick,
    handleAcceptDictation,
    handleCancelDictation,
    handlePrimaryButtonClick,
    handleShowAttachmentInTextField,
    handleRealtimeVoiceClick,
    handleRealtimeVoicePrewarm,
    handleSubmit,
    isAuthenticatedForChrome,
    isStreaming,
    isListening,
    isAutonomousPanelOpen,
    isOrchestrationModalOpen,
    loading,
    loginPromptText,
    modeBadges,
    modelSelector,
    platformRuntime,
    reasoningEffort,
    modelSelectorTriggerRef,
    openOrchestrationModal,
    preferences,
    prompt,
    promptTemplates,
    realtimeVoice,
    setIsAutonomousPanelOpen,
    setIsOrchestrationModalOpen,
    setPrompt,
    textareaRef,
    user,
    viewState,
  } = usePromptFormController({
    clearErrorMessage,
    ensureConversationId,
    initialModelSelector,
    isDisabled,
    persistMessages,
    privateChat,
    mcpToolItems,
    promptValue,
    onPromptValueChange,
    onRealtimeVoiceActiveChange,
    onRealtimeTranscriptMessagesChange,
    onConversationId,
    onLocalCommand,
    onMcpApproval,
    onSendMessage,
    desktopTaskMode,
  });
  const taskModeView = resolveTaskModePromptView({
    desktopTaskMode,
    defaultMinPromptHeight: viewState.minPromptHeight,
    defaultPlaceholderText: viewState.placeholderText,
    privateChat,
    variant,
  });

  return (
    <div
      className={`prompt-form-wrapper ${variant === 'centered' ? 'centered-variant' : 'bottom-variant'} ${taskModeView.wrapperModeClass}`}
    >
      <PromptFormHeader
        loginPromptText={loginPromptText}
        mcpToolItems={showMcpToolCatalog ? mcpToolItems : []}
        mcpToolSummary={showMcpToolCatalog ? mcpToolSummary : null}
        modeBadges={modeBadges}
        onInsertMcpTool={handleInsertMcpTool}
        shouldShowLoginNote={viewState.shouldShowLoginNote}
      />

      <RealtimeVoiceSessionPanel
        endedDurationMs={realtimeVoice.endedDurationMs}
        isActive={realtimeVoice.isActive}
        isCapturing={realtimeVoice.isCapturing}
        isPlaying={realtimeVoice.isPlaying}
      />

      <PromptComposerForm
        controlsDisabled={viewState.controlsDisabled}
        customRoleModels={preferences.customRoleModels}
        effectiveModelId={modelSelector.effectiveModelId}
        effectiveModelLabel={modelSelector.currentModelLabel}
        fileAccept={viewState.fileAccept}
        fileInputRef={attachments.fileInputRef}
        files={attachments.files}
        handleFileChange={attachments.handleFileChange}
        handleFileDragLeave={attachments.handleDragLeave}
        handleFileDragOver={attachments.handleDragOver}
        handleFileDrop={attachments.handleDrop}
        iconButtonBaseClass={viewState.iconButtonBaseClass}
        isDraggingFiles={attachments.isDraggingFiles}
        isCompactForm={viewState.isCompactForm}
        isListening={isListening}
        loading={loading}
        minPromptHeight={taskModeView.minPromptHeight}
        workMode={taskModeView.centeredWorkMode}
        showContextWindow={
          platformRuntime === 'desktop' &&
          (desktopTaskMode === 'code' || desktopTaskMode === 'work')
        }
        modelOptions={modelSelector.filteredModelOptions}
        modelSelectorDisabled={viewState.modelSelectorDisabled}
        modelSelectorEnabled={modelSelector.modelSelectorEnabled}
        modelSelectorLoading={modelSelector.modelSelectorLoading}
        modelSelectorTriggerRef={modelSelectorTriggerRef}
        onClearCustomModels={() => preferences.setCustomRoleModels({})}
        onCustomizeOrchestration={openOrchestrationModal}
        onFileButtonClick={attachments.triggerFileDialog}
        onKeyDown={handleKeyDown}
        onModelSelect={handleModelSelect}
        reasoningEffortLevels={reasoningEffort.levels}
        selectedReasoningEffort={reasoningEffort.selectedEffort ?? null}
        reasoningEffortVariant={platformRuntime === 'desktop' ? 'desktop' : 'select'}
        onReasoningEffortChange={reasoningEffort.setSelectedEffort}
        onDictationClick={() => {
          void handleDictationButtonClick();
        }}
        onAcceptDictation={handleAcceptDictation}
        onCancelDictation={handleCancelDictation}
        onPrimaryButtonClick={handlePrimaryButtonClick}
        onRealtimeVoiceClick={handleRealtimeVoiceClick}
        onRealtimeVoicePrewarm={handleRealtimeVoicePrewarm}
        onInsertPromptTemplate={handleInsertPromptTemplate}
        onQuickModeToggle={() => preferences.setQuickModeEnabled((prev) => !prev)}
        onRemoveFileAtIndex={attachments.removeFile}
        onShowAttachmentInTextField={handleShowAttachmentInTextField}
        onLargePaste={handleLargePaste}
        onSubmit={(event) => {
          handleSubmit(event);
        }}
        placeholderText={taskModeView.placeholderText}
        primaryButtonClassName={viewState.primaryButtonClassName}
        primaryButtonDisabled={viewState.primaryAction.disabled}
        primaryButtonMode={viewState.primaryAction.mode}
        primaryButtonTitle={viewState.primaryAction.title}
        prompt={prompt}
        promptTemplates={promptTemplates}
        quickModeEnabled={preferences.quickModeEnabled}
        agentCount={preferences.agentCount}
        onAgentCountChange={preferences.setAgentCount}
        showRealtimeVoice={taskModeView.showRealtimeVoice}
        realtimeVoiceActive={realtimeVoice.isActive}
        realtimeVoiceDisabled={
          realtimeVoice.isActive
            ? false
            : !isAuthenticatedForChrome ||
              viewState.interactionsDisabled ||
              loading ||
              isStreaming ||
              isListening
        }
        realtimeVoiceTitle={
          !realtimeVoice.isActive && !isAuthenticatedForChrome
            ? 'Login required to use voice'
            : realtimeVoice.isActive
              ? 'End voice chat'
              : 'Use voice'
        }
        setPrompt={setPrompt}
        textareaRef={textareaRef}
        userPlan={user?.plan}
        variant={variant}
      />
      <PromptFormFooter
        agentCount={preferences.agentCount}
        autonomyEnabled={preferences.autonomyEnabled}
        budget={preferences.budget}
        budgetLimit={budgetLimit}
        currentSpend={currentSpend}
        defaultModelId={modelSelector.effectiveModelId}
        defaultModelLabel={modelSelector.currentModelLabel}
        isAutonomousPanelOpen={isAutonomousPanelOpen}
        isListening={isListening}
        isOrchestrationModalOpen={isOrchestrationModalOpen}
        isStreaming={isStreaming}
        models={modelSelector.modelOptions}
        roleModels={preferences.customRoleModels}
        userPlan={user?.plan}
        onAgentCountChange={preferences.setAgentCount}
        onBudgetChange={preferences.setBudget}
        onCloseAutonomousPanel={() => setIsAutonomousPanelOpen(false)}
        onCloseOrchestrationModal={() => setIsOrchestrationModalOpen(false)}
        onRoleModelChange={(role, modelId) =>
          preferences.setCustomRoleModels((prev) => ({
            ...prev,
            [role]: modelId,
          }))
        }
      />
    </div>
  );
};

export default PromptForm;
