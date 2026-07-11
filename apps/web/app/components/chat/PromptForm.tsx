'use client';

import type { ModelSelectorResponse } from '@taskforceai/contracts/contracts';
import { type McpRuntimeToolDescriptor, type PendingApproval } from '@taskforceai/client-core';
import React from 'react';

import { PromptComposerForm } from './prompt-form/PromptComposerForm';
import { PromptFormFooter } from './prompt-form/PromptFormFooter';
import { PromptFormHeader } from './prompt-form/PromptFormHeader';
import { RealtimeVoiceSessionPanel } from './prompt-form/RealtimeVoiceSessionPanel';
import type { RealtimeVoiceTranscriptMessage } from './prompt-form/useRealtimeVoiceSession';
import { usePromptFormController } from './prompt-form/usePromptFormController';

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
}

const defaultValue = <T,>(value: T | null | undefined, fallback: T): T => value ?? fallback;

const lockedComputerUseView = (
  status: ReturnType<typeof usePromptFormController>['lockedComputerUseStatus']
) => ({
  available: Boolean(status?.supported || status?.requiresInstall),
  label: status?.requiresInstall && !status.enabled ? 'Install Local Computer Use' : 'This Mac',
});

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
    handleKeyDown,
    handleModelSelect,
    handleDictationButtonClick,
    handleAcceptDictation,
    handleCancelDictation,
    handlePrimaryButtonClick,
    handleRealtimeVoiceClick,
    handleRealtimeVoicePrewarm,
    handleSubmit,
    isAuthenticatedForChrome,
    isStreaming,
    isListening,
    isAutonomousPanelOpen,
    isAutonomyAllowed,
    isComputerUseAllowed,
    isOrchestrationModalOpen,
    loading,
    lockedComputerUseStatus,
    computerUseTarget,
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
    toggleLockedComputerUse,
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
  });
  const lockedComputerUse = lockedComputerUseView(lockedComputerUseStatus);

  return (
    <div
      className={`prompt-form-wrapper ${variant === 'centered' ? 'centered-variant' : 'bottom-variant'}`}
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
        autonomyEnabled={preferences.autonomyEnabled}
        computerUseEnabled={preferences.computerUseEnabled}
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
        isAutonomyAllowed={isAutonomyAllowed}
        isCompactForm={viewState.isCompactForm}
        isComputerUseAllowed={isComputerUseAllowed}
        isListening={isListening}
        loading={loading}
        lockedComputerUseAvailable={lockedComputerUse.available}
        lockedComputerUseEnabled={computerUseTarget === 'local'}
        lockedComputerUseLabel={lockedComputerUse.label}
        minPromptHeight={viewState.minPromptHeight}
        modelOptions={modelSelector.filteredModelOptions}
        modelSelectorDisabled={viewState.modelSelectorDisabled}
        modelSelectorEnabled={modelSelector.modelSelectorEnabled}
        modelSelectorLoading={modelSelector.modelSelectorLoading}
        modelSelectorTriggerRef={modelSelectorTriggerRef}
        onAutonomyToggle={() => preferences.setAutonomyEnabled((prev) => !prev)}
        onClearCustomModels={() => preferences.setCustomRoleModels({})}
        onComputerUseToggle={() => preferences.setComputerUseEnabled((prev) => !prev)}
        onCustomizeOrchestration={openOrchestrationModal}
        onFileButtonClick={attachments.triggerFileDialog}
        onKeyDown={handleKeyDown}
        onLockedComputerUseToggle={toggleLockedComputerUse}
        onModelSelect={handleModelSelect}
        reasoningEffortLevels={reasoningEffort.levels}
        selectedReasoningEffort={reasoningEffort.selectedEffort ?? null}
        reasoningEffortVariant={platformRuntime === 'desktop' ? 'desktop' : 'select'}
        onReasoningEffortChange={reasoningEffort.setSelectedEffort}
        onOpenAutonomousPanel={() => setIsAutonomousPanelOpen(true)}
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
        onSubmit={(event) => {
          handleSubmit(event);
        }}
        onUseLoggedInServicesToggle={() =>
          preferences.setComputerUseSessionMode(
            preferences.computerUseSessionMode === 'logged_in' ? 'logged_out' : 'logged_in'
          )
        }
        placeholderText={viewState.placeholderText}
        primaryButtonClassName={viewState.primaryButtonClassName}
        primaryButtonDisabled={viewState.primaryAction.disabled}
        primaryButtonMode={viewState.primaryAction.mode}
        primaryButtonTitle={viewState.primaryAction.title}
        prompt={prompt}
        promptTemplates={promptTemplates}
        quickModeEnabled={preferences.quickModeEnabled}
        showRealtimeVoice={!privateChat}
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
        useLoggedInServices={preferences.computerUseSessionMode === 'logged_in'}
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
