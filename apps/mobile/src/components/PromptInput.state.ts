import { useCallback, useMemo, useState } from 'react';
import { Alert } from 'react-native';

import { buildPromptRoutingMetadata, ok, type McpRuntimeToolDescriptor } from '@taskforceai/shared';
import type { OrchestrationConfig } from '@taskforceai/shared/chat/orchestration-storage';
import {
  applyStoredOrchestrationConfig,
  buildOrchestrationConfig,
  clampOrchestrationAgentCount,
  useHydratedModelSelector,
  usePersistedOrchestrationConfig,
  usePromptSubmission,
  type ExecutePromptSubmitParams,
} from '@taskforceai/react-core';

import { createModuleLogger } from '../logger';

import { MAX_ATTACHMENTS, type Attachment } from './PromptInput.internal';
import { useModelSelectorQuery } from '../hooks/api/modelSelector';
import { usePromptAttachments } from '../hooks/usePromptAttachments';
import { usePromptVoice } from '../hooks/usePromptVoice';
import {
  readStoredOrchestrationConfig,
  persistOrchestrationConfig,
} from '../utils/orchestration-preference';
import { loadModelPreference, storeModelPreference } from '../utils/model-preference';

const logger = createModuleLogger('PromptInputState');

export interface PromptInputProps {
  onSend: (
    message: string,
    metadata?: {
      modelId?: string;
      quickModeEnabled?: boolean;
      computerUseEnabled?: boolean;
      budget?: number;
      agentCount?: number;
    },
    attachment_ids?: string[]
  ) => void | Promise<void>;
  isDisabled?: boolean;
  placeholder?: string;
  onFileUpload?: () => void;
  onVoiceMode?: () => void;
  onRealtimeVoice?: () => void;
  realtimeVoiceActive?: boolean;
  realtimeVoiceDisabled?: boolean;
  quickModeEnabled?: boolean;
  onQuickModeToggle?: () => void;
  autonomousModeEnabled?: boolean;
  onAutonomousModeToggle?: () => void;
  computerUseEnabled?: boolean;
  onComputerUseToggle?: () => void;
  onCustomizeOrchestration?: () => void;
  onOpenBudgetPanel?: () => void;
  modelOptions?: Array<{ id: string; label: string; badge?: string; description?: string }>;
  autonomyEnabled?: boolean;
  roleModels?: Record<string, string>;
  onRoleModelChange?: (role: string, modelId: string) => void;
  budget?: number;
  onBudgetChange?: (budget: number | undefined) => void;
  userPlan?: string | null;
  agentCount?: number;
  onAgentCountChange?: (count: number) => void;
  mcpToolSummary?: string | null;
  mcpToolItems?: McpRuntimeToolDescriptor[];
  isAuthenticated?: boolean;
}

export function usePromptInputState({
  onSend,
  isDisabled = false,
  onFileUpload,
  onVoiceMode,
  onRealtimeVoice,
  realtimeVoiceActive = false,
  realtimeVoiceDisabled = false,
  quickModeEnabled: quickModeEnabledProp,
  onQuickModeToggle,
  autonomousModeEnabled: autonomousModeEnabledProp,
  onAutonomousModeToggle,
  computerUseEnabled: computerUseEnabledProp,
  onComputerUseToggle,
  onCustomizeOrchestration,
  onOpenBudgetPanel,
  modelOptions: modelOptionsProp,
  autonomyEnabled: autonomyEnabledProp = false,
  roleModels: roleModelsProp = {},
  onRoleModelChange,
  budget: budgetProp,
  onBudgetChange,
  userPlan,
  agentCount: agentCountProp,
  onAgentCountChange: onAgentCountChangeProp,
  isAuthenticated = true,
}: PromptInputProps) {
  const [message, setMessage] = useState('');
  const [isMoreOptionsOpen, setIsMoreOptionsOpen] = useState(false);
  const [internalQuickModeEnabled, setInternalQuickModeEnabled] = useState(
    quickModeEnabledProp ?? true
  );
  const [internalAutonomousModeEnabled, setInternalAutonomousModeEnabled] = useState(
    autonomousModeEnabledProp ?? false
  );
  const [internalComputerUseEnabled, setInternalComputerUseEnabled] = useState(
    computerUseEnabledProp ?? false
  );
  const [internalAgentCount, setInternalAgentCount] = useState<number>(4);

  const quickModeEnabled = quickModeEnabledProp ?? internalQuickModeEnabled;
  const autonomousModeEnabled = autonomousModeEnabledProp ?? internalAutonomousModeEnabled;
  const computerUseEnabled = computerUseEnabledProp ?? internalComputerUseEnabled;
  const effectiveAgentCount = agentCountProp ?? internalAgentCount;
  const setEffectiveAgentCount = onAgentCountChangeProp ?? setInternalAgentCount;
  const orchestrationConfig = useMemo(
    () =>
      buildOrchestrationConfig({
        roleModels: roleModelsProp,
        budget: budgetProp,
        agentCount: effectiveAgentCount,
      }),
    [budgetProp, effectiveAgentCount, roleModelsProp]
  );

  const applyStoredConfig = useCallback(
    (config: OrchestrationConfig) => {
      applyStoredOrchestrationConfig(config, {
        setRoleModel: onRoleModelChange,
        setBudget: onBudgetChange,
        setAgentCount: (count) => setEffectiveAgentCount(clampOrchestrationAgentCount(count)),
        onRoleModelError: (error, { role, modelId }) =>
          logger.warn('Failed to apply stored role model', { role, modelId, error }),
      });
    },
    [onBudgetChange, onRoleModelChange, setEffectiveAgentCount]
  );

  usePersistedOrchestrationConfig({
    currentConfig: orchestrationConfig,
    loadStoredConfig: readStoredOrchestrationConfig,
    persistConfig: persistOrchestrationConfig,
    applyStoredConfig,
    onLoadError: (error) => logger.error('Failed to load stored orchestration config', { error }),
  });

  const {
    attachments,
    pickDocuments,
    pickImages,
    removeAttachment,
    clearAttachments,
    uploadAttachment,
    remainingSlots,
  } = usePromptAttachments();

  const { isListening, transcriptionHint, startListening, acceptListening, cancelListening } =
    usePromptVoice();
  const modelSelectorQuery = useModelSelectorQuery();

  const modelSelector = useHydratedModelSelector({
    data: modelSelectorQuery.data,
    loadStoredSelection: loadModelPreference,
    persistSelection: storeModelPreference,
    loading: modelSelectorQuery.isLoading,
    closeMenuWhen: isDisabled || isListening,
    logHydrationError: (error) => logger.error('Failed to hydrate model preference', { error }),
  });

  const isModelSelectorEnabled = modelSelector.modelSelectorEnabled;
  const effectiveModelId = modelSelector.effectiveModelId;

  const handleFileUpload = useCallback(() => {
    if (remainingSlots <= 0) {
      Alert.alert('Attachment Limit', `You can only attach ${MAX_ATTACHMENTS} files per message.`);
      return;
    }
    if (onFileUpload) {
      onFileUpload();
      return;
    }
    Alert.alert('Add Attachment', 'Choose a source', [
      { text: 'Photo Library', onPress: () => void pickImages() },
      { text: 'Browse Files', onPress: () => void pickDocuments() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [onFileUpload, pickDocuments, pickImages, remainingSlots]);

  const { loading: isPreparingMessage, handleSubmit: handleSend } = usePromptSubmission<Attachment>({
    prompt: message,
    files: attachments,
    modelSelectorEnabled: isModelSelectorEnabled,
    selectedModelId: effectiveModelId,
    ensureConversationId: async () => 'ignored', // Handled by onSend downstream
    setErrorMessage: (msg) => Alert.alert('Send Failed', msg),
    clearErrorMessage: () => { },
    resetFormState: () => {
      setMessage('');
      clearAttachments();
    },
    hasRateLimitError: isDisabled,
    isListening,
    quickModeEnabled,
    computerUseEnabled,
    autonomyEnabled: autonomousModeEnabled,
    agentCount: quickModeEnabled ? 1 : effectiveAgentCount,
    isAuthenticated,
    userPlan: userPlan ?? null,
    submitPrompt: async (params: ExecutePromptSubmitParams) => {
      const attachmentIds = params.attachment_ids ?? [];
      const routingMetadata = buildPromptRoutingMetadata({
        prompt: params.prompt,
        hasAttachments: attachmentIds.length > 0,
        currentModelId: params.modelId,
        currentQuickMode: params.quickModeEnabled,
        currentComputerUse: params.computerUseEnabled,
      });

      setMessage('');
      try {
        await onSend(
          params.prompt,
          {
            ...routingMetadata,
            budget: budgetProp,
            agentCount: params.quickModeEnabled === true ? 1 : effectiveAgentCount,
          },
          attachmentIds.length > 0 ? attachmentIds : undefined
        );
      } catch (error) {
        setMessage(params.prompt);
        throw error;
      }
      clearAttachments();
      return ok({ type: 'streaming_started', message: 'Streaming started' });
    },
    uploadAttachment,
    enqueuePrompt: async () => { }, // Handled downstream
    startStreaming: async () => { }, // Handled downstream
    getRateLimitMessage: () => 'Rate limit reached',
    getRateLimitResetTime: () => undefined,
    allowUnauthenticatedPrompt: (value) => value.trim().length > 0 && attachments.length === 0,
  });

  const handleVoiceDictation = useCallback(async () => {
    if (onVoiceMode) {
      onVoiceMode();
    }
    await startListening((transcript) => {
      setMessage((prev) => (prev.trim() ? `${prev.trim()} ${transcript}` : transcript));
    });
  }, [onVoiceMode, startListening]);

  const handleVoiceDictationAccept = useCallback(async () => {
    await acceptListening();
  }, [acceptListening]);

  const handleVoiceDictationCancel = useCallback(async () => {
    await cancelListening();
  }, [cancelListening]);

  const handleRealtimeVoice = useCallback(() => {
    onRealtimeVoice?.();
  }, [onRealtimeVoice]);

  const handleQuickModeToggle = useCallback(() => {
    if (onQuickModeToggle) {
      onQuickModeToggle();
    } else {
      setInternalQuickModeEnabled((prev) => !prev);
    }
  }, [onQuickModeToggle]);

  const handleAutonomousModeToggle = useCallback(() => {
    if (onAutonomousModeToggle) {
      onAutonomousModeToggle();
    } else {
      setInternalAutonomousModeEnabled((prev) => !prev);
    }
  }, [onAutonomousModeToggle]);

  const handleComputerUseToggle = useCallback(() => {
    if (onComputerUseToggle) {
      onComputerUseToggle();
    } else {
      setInternalComputerUseEnabled((prev) => !prev);
    }
  }, [onComputerUseToggle]);

  return {
    message,
    setMessage,
    attachments,
    remainingAttachmentSlots: remainingSlots,
    removeAttachment,
    uploadAttachment,
    handleFileUpload,
    isPreparingMessage,
    isListening,
    transcriptionHint,
    handleSend,
    handleVoiceDictation,
    handleVoiceDictationAccept,
    handleVoiceDictationCancel,
    handleRealtimeVoice,
    realtimeVoiceActive,
    realtimeVoiceDisabled,
    modelOptions: modelSelector.modelOptions,
    currentModelLabel: modelSelector.currentModelLabel,
    effectiveModelId,
    isModelSelectorLoading: modelSelector.modelSelectorLoading,
    shouldRenderModelSelector: modelSelector.shouldRenderModelSelector,
    isModelMenuOpen: modelSelector.isModelMenuOpen,
    setIsModelMenuOpen: modelSelector.setIsModelMenuOpen,
    handleModelSelect: modelSelector.handleModelSelect,
    isDisabled,
    isMoreOptionsOpen,
    setIsMoreOptionsOpen,
    quickModeEnabled,
    handleQuickModeToggle,
    autonomousModeEnabled,
    handleAutonomousModeToggle,
    computerUseEnabled,
    handleComputerUseToggle,
    onCustomizeOrchestration,
    onOpenBudgetPanel,
    orchestrationModels: modelOptionsProp,
    autonomyEnabled: autonomyEnabledProp,
    roleModels: roleModelsProp,
    onRoleModelChange,
    budget: budgetProp,
    onBudgetChange,
    agentCount: effectiveAgentCount,
    onAgentCountChange: setEffectiveAgentCount,
    userPlan,
  };
}
