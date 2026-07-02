import {
  resolvePromptPrimaryAction,
  type McpRuntimeToolDescriptor,
} from '@taskforceai/shared';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useRef } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AttachmentsBar } from './PromptInput.AttachmentsBar';
import { PromptInputActions } from './PromptInput.Actions';
import { PromptInputMcpToolSummary } from './PromptInput.McpToolSummary';
import { ModeBadges } from './PromptInput.ModeBadges';
import { MoreOptionsSheet } from './PromptInput.MoreOptionsSheet';
import { usePromptInputModeBadges } from './PromptInput.useModeBadges';
import { PROMPT_BUBBLE_GRADIENT } from './PromptInput.internal';
import type { Attachment } from './PromptInput.internal';
import { styles } from './PromptInput.styles';

type PromptInputViewProps = {
  message: string;
  setMessage: (next: string) => void;
  placeholder: string;
  attachments: Attachment[];
  removeAttachment: (id: string) => void;
  isPreparingMessage: boolean;
  isListening: boolean;
  transcriptionHint: string | null;
  handleFileUpload: () => void;
  handleSend: () => void;
  handleVoiceDictation: () => void;
  handleVoiceDictationAccept: () => void;
  handleVoiceDictationCancel: () => void;
  handleRealtimeVoice?: () => void;
  realtimeVoiceActive?: boolean;
  realtimeVoiceDisabled?: boolean;
  modelOptions: Array<{ id: string; label: string }>;
  currentModelLabel: string;
  effectiveModelId: string | null;
  isModelSelectorLoading: boolean;
  shouldRenderModelSelector: boolean;
  isModelMenuOpen: boolean;
  setIsModelMenuOpen: (next: boolean) => void;
  handleModelSelect: (modelId: string) => void;
  isDisabled: boolean;
  promptMaxWidth: number;
  bottomPadding: number;
  isMoreOptionsOpen: boolean;
  setIsMoreOptionsOpen: (next: boolean) => void;
  quickModeEnabled: boolean;
  handleQuickModeToggle: () => void;
  autonomousModeEnabled: boolean;
  handleAutonomousModeToggle: () => void;
  computerUseEnabled: boolean;
  handleComputerUseToggle: () => void;
  onCustomizeOrchestration?: () => void;
  onOpenBudgetPanel?: () => void;
  autonomyEnabled?: boolean;
  roleModels?: Record<string, string>;
  agentCount?: number;
  onAgentCountChange?: (count: number) => void;
  userPlan?: string | null;
  mcpToolSummary?: string | null;
  mcpToolItems?: McpRuntimeToolDescriptor[];
};

export function PromptInputView({
  message,
  setMessage,
  placeholder,
  attachments,
  removeAttachment,
  isPreparingMessage,
  isListening,
  transcriptionHint,
  handleFileUpload,
  handleSend,
  handleVoiceDictation,
  handleVoiceDictationAccept,
  handleVoiceDictationCancel,
  handleRealtimeVoice,
  realtimeVoiceActive = false,
  realtimeVoiceDisabled = false,
  modelOptions,
  currentModelLabel,
  effectiveModelId,
  isModelSelectorLoading,
  shouldRenderModelSelector,
  isModelMenuOpen,
  setIsModelMenuOpen,
  handleModelSelect,
  isDisabled,
  promptMaxWidth,
  bottomPadding,
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
  autonomyEnabled,
  roleModels,
  agentCount,
  onAgentCountChange,
  userPlan,
  mcpToolSummary,
  mcpToolItems = [],
}: PromptInputViewProps) {
  const inputRef = useRef<TextInput | null>(null);

  useEffect(() => {
    if (isDisabled || realtimeVoiceActive) return;

    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 180);

    return () => clearTimeout(timer);
  }, [isDisabled, realtimeVoiceActive]);

  const disableAttachments = isDisabled || isPreparingMessage || isListening;
  const primaryAction = resolvePromptPrimaryAction({
    prompt: message,
    hasAttachments: attachments.length > 0,
    controlsDisabled: isDisabled || isPreparingMessage || isListening,
    interactionsDisabled: isDisabled,
    loading: isPreparingMessage,
    isListening,
  });

  const modeBadges = usePromptInputModeBadges({
    quickModeEnabled,
    autonomousModeEnabled,
    computerUseEnabled,
    roleModels,
    onCustomizeOrchestration,
    onQuickModeToggle: handleQuickModeToggle,
    onAutonomousModeToggle: handleAutonomousModeToggle,
    onComputerUseToggle: handleComputerUseToggle,
  });

  const voiceDictationButtonStyles = useMemo(
    () => [
      styles.inlineIconButton,
      {
        borderColor: isListening ? '#f87171' : 'rgba(255,255,255,0.25)',
        opacity: isDisabled || isPreparingMessage ? 0.5 : 1,
      },
    ],
    [isListening, isDisabled, isPreparingMessage]
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <View className="px-md pt-md bg-background" style={{ paddingBottom: bottomPadding }}>
        <AttachmentsBar attachments={attachments} onRemove={removeAttachment} errorColor="#f87171" />

        {transcriptionHint && (
          <Text className="mb-xs px-md text-text-muted text-xs">{transcriptionHint}</Text>
        )}

        {isListening && (
          <View
            className="mb-sm px-sm py-xs flex-row items-center rounded-2xl"
            style={{ backgroundColor: 'rgba(220, 38, 38, 0.15)' }}
          >
            <View className="mr-xs bg-error h-2.5 w-2.5 rounded-full" />
            <Text className="text-error text-xs font-semibold">
              Recording — cancel or finish dictation
            </Text>
          </View>
        )}

        <PromptInputMcpToolSummary
          message={message}
          summary={mcpToolSummary}
          items={mcpToolItems}
          onMessageChange={setMessage}
        />

        <ModeBadges badges={modeBadges} />

        <View style={styles.rowWrapper}>
          <LinearGradient
            colors={PROMPT_BUBBLE_GRADIENT}
            start={{ x: 0.05, y: 0.1 }}
            end={{ x: 0.95, y: 0.9 }}
            style={[
              styles.promptBubble,
              {
                maxWidth: promptMaxWidth,
                borderColor: 'rgba(82,137,255,0.45)',
                shadowColor: '#01030a',
                shadowOffset: { width: 0, height: 22 },
                shadowOpacity: 0.55,
                shadowRadius: 32,
                elevation: 10,
              },
            ]}
          >
            {/* Text input row */}
            <View style={styles.promptBody}>
              <TextInput
                ref={inputRef}
                style={styles.textInput}
                value={message}
                onChangeText={setMessage}
                placeholder={placeholder}
                placeholderTextColor="rgba(255, 255, 255, 0.5)"
                multiline
                maxLength={4000}
                editable={!isDisabled && !isPreparingMessage && !isListening}
                onSubmitEditing={() => handleSend()}
                testID="message-input"
                accessibilityLabel="Message input"
                accessibilityHint="Type your message to the AI assistant here"
                blurOnSubmit={false}
                enablesReturnKeyAutomatically
                autoCorrect
                spellCheck
                autoCapitalize="sentences"
                keyboardAppearance="dark"
              />
            </View>

            <PromptInputActions
              currentModelLabel={currentModelLabel}
              disableAttachments={disableAttachments}
              effectiveModelId={effectiveModelId}
              handleFileUpload={handleFileUpload}
              handleModelSelect={handleModelSelect}
              handleSend={handleSend}
              handleVoiceDictation={handleVoiceDictation}
              handleVoiceDictationAccept={handleVoiceDictationAccept}
              handleVoiceDictationCancel={handleVoiceDictationCancel}
              handleRealtimeVoice={handleRealtimeVoice}
              isDisabled={isDisabled}
              isListening={isListening}
              isModelMenuOpen={isModelMenuOpen}
              isModelSelectorLoading={isModelSelectorLoading}
              isPreparingMessage={isPreparingMessage}
              modelOptions={modelOptions}
              primaryAction={primaryAction}
              setIsModelMenuOpen={setIsModelMenuOpen}
              setIsMoreOptionsOpen={setIsMoreOptionsOpen}
              shouldRenderModelSelector={shouldRenderModelSelector}
              realtimeVoiceActive={realtimeVoiceActive}
              realtimeVoiceDisabled={realtimeVoiceDisabled}
              voiceDictationButtonStyles={voiceDictationButtonStyles}
            />
          </LinearGradient>
        </View>

        <MoreOptionsSheet
          visible={isMoreOptionsOpen}
          onClose={() => setIsMoreOptionsOpen(false)}
          quickModeEnabled={quickModeEnabled}
          onQuickModeToggle={() => {
            handleQuickModeToggle();
          }}
          autonomousModeEnabled={autonomousModeEnabled}
          onAutonomousModeToggle={() => {
            handleAutonomousModeToggle();
          }}
          computerUseEnabled={computerUseEnabled}
          onComputerUseToggle={() => {
            handleComputerUseToggle();
          }}
          onCustomizeOrchestration={onCustomizeOrchestration}
          onSetBudget={onOpenBudgetPanel}
          autonomyEnabled={autonomyEnabled}
          agentCount={agentCount}
          onAgentCountChange={onAgentCountChange}
          userPlan={userPlan}
        />
      </View>
    </KeyboardAvoidingView>
  );
}
