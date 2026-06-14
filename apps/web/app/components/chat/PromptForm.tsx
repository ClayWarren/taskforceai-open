'use client';

import type { ModelSelectorResponse } from '@taskforceai/contracts/contracts';
import { type McpRuntimeToolDescriptor, type PendingApproval } from '@taskforceai/shared';
import React from 'react';

import { PromptComposerForm } from './prompt-form/PromptComposerForm';
import { PromptFormFooter } from './prompt-form/PromptFormFooter';
import { PromptFormHeader } from './prompt-form/PromptFormHeader';
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
  ensureConversationId: () => Promise<string>;
  initialModelSelector?: ModelSelectorResponse | null;
  promptValue?: string;
  onPromptValueChange?: React.Dispatch<React.SetStateAction<string>>;
}

const PromptForm: React.FC<PromptFormProps> = ({
  onSendMessage,
  onLocalCommand,
  onMcpApproval,
  mcpToolSummary = null,
  mcpToolItems = [],
  showMcpToolCatalog = false,
  onConversationId,
  clearErrorMessage,
  variant = 'bottom',
  isDisabled = false,
  ensureConversationId,
  initialModelSelector = null,
  promptValue,
  onPromptValueChange,
}) => {
  const {
    attachments,
    budgetLimit,
    currentSpend,
    handleInsertMcpTool,
    handleInsertPromptTemplate,
    handleKeyDown,
    handleModelSelect,
    handlePrimaryButtonClick,
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
    openOrchestrationModal,
    preferences,
    prompt,
    promptTemplates,
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
    mcpToolItems,
    promptValue,
    onPromptValueChange,
    onConversationId,
    onLocalCommand,
    onMcpApproval,
    onSendMessage,
  });

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
        isAuthenticated={isAuthenticatedForChrome}
        isCompactForm={viewState.isCompactForm}
        isComputerUseAllowed={isComputerUseAllowed}
        isListening={isListening}
        loading={loading}
        lockedComputerUseAvailable={Boolean(
          lockedComputerUseStatus?.supported || lockedComputerUseStatus?.requiresInstall
        )}
        lockedComputerUseEnabled={computerUseTarget === 'local'}
        lockedComputerUseLabel={
          lockedComputerUseStatus?.enabled
            ? 'This Mac'
            : lockedComputerUseStatus?.requiresInstall
              ? 'Install Local Computer Use'
              : 'This Mac'
        }
        minPromptHeight={viewState.minPromptHeight}
        modelOptions={modelSelector.filteredModelOptions}
        modelSelectorDisabled={viewState.modelSelectorDisabled}
        modelSelectorEnabled={modelSelector.modelSelectorEnabled}
        modelSelectorLoading={modelSelector.modelSelectorLoading}
        onAutonomyToggle={() => preferences.setAutonomyEnabled((prev) => !prev)}
        onClearCustomModels={() => preferences.setCustomRoleModels({})}
        onComputerUseToggle={() => preferences.setComputerUseEnabled((prev) => !prev)}
        onCustomizeOrchestration={openOrchestrationModal}
        onFileButtonClick={attachments.triggerFileDialog}
        onKeyDown={handleKeyDown}
        onLockedComputerUseToggle={toggleLockedComputerUse}
        onModelSelect={handleModelSelect}
        onOpenAutonomousPanel={() => setIsAutonomousPanelOpen(true)}
        onPrimaryButtonClick={handlePrimaryButtonClick}
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
