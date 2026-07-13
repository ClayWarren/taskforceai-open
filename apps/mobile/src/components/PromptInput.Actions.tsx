import type { resolvePromptPrimaryAction } from '@taskforceai/presenters';
import type { ModelOptionSummary } from '@taskforceai/contracts/contracts';
import type { StyleProp, ViewStyle } from 'react-native';
import { Text, TouchableOpacity, View } from 'react-native';

import { Icon } from './Icon';
import { PromptInputModelSelector } from './PromptInput.ModelSelector';
import { styles } from './PromptInput.styles';

type PrimaryAction = ReturnType<typeof resolvePromptPrimaryAction>;
const defaultBoolean = (value: boolean | undefined): boolean => value ?? false;

interface PromptInputActionsProps {
  currentModelLabel: string;
  disableAttachments: boolean;
  effectiveModelId: string | null;
  handleFileUpload: () => void;
  handleModelSelect: (modelId: string) => void;
  handleSend: () => void;
  handleVoiceDictation: () => void;
  handleVoiceDictationAccept: () => void;
  handleVoiceDictationCancel: () => void;
  handleRealtimeVoice?: () => void;
  isDisabled: boolean;
  isListening: boolean;
  isModelMenuOpen: boolean;
  isModelSelectorLoading: boolean;
  isPreparingMessage: boolean;
  modelOptions: ModelOptionSummary[];
  userPlan?: string | null;
  reasoningEffortLevels: string[];
  defaultReasoningEffort: string | null;
  selectedReasoningEffort: string | null;
  onReasoningEffortChange: (effort: string) => void;
  quickModeEnabled: boolean;
  onQuickModeToggle: () => void;
  onCustomizeOrchestration?: () => void;
  agentCount?: number;
  onAgentCountChange?: (count: number) => void;
  primaryAction: PrimaryAction;
  setIsModelMenuOpen: (next: boolean) => void;
  shouldRenderModelSelector: boolean;
  realtimeVoiceActive?: boolean;
  realtimeVoiceDisabled?: boolean;
  voiceDictationButtonStyles: StyleProp<ViewStyle>;
}

export function PromptInputActions({
  currentModelLabel,
  disableAttachments,
  effectiveModelId,
  handleFileUpload,
  handleModelSelect,
  handleSend,
  handleVoiceDictation,
  handleVoiceDictationAccept,
  handleVoiceDictationCancel,
  handleRealtimeVoice,
  isDisabled,
  isListening,
  isModelMenuOpen,
  isModelSelectorLoading,
  isPreparingMessage,
  modelOptions,
  userPlan,
  reasoningEffortLevels,
  defaultReasoningEffort,
  selectedReasoningEffort,
  onReasoningEffortChange,
  quickModeEnabled,
  onQuickModeToggle,
  onCustomizeOrchestration,
  agentCount,
  onAgentCountChange,
  primaryAction,
  setIsModelMenuOpen,
  shouldRenderModelSelector,
  realtimeVoiceActive: optionalRealtimeVoiceActive,
  realtimeVoiceDisabled: optionalRealtimeVoiceDisabled,
  voiceDictationButtonStyles,
}: PromptInputActionsProps) {
  const realtimeVoiceActive = defaultBoolean(optionalRealtimeVoiceActive);
  const realtimeVoiceDisabled = defaultBoolean(optionalRealtimeVoiceDisabled);
  const shouldRenderRealtimeVoice = Boolean(handleRealtimeVoice);
  const liveVoiceDisabled = realtimeVoiceActive
    ? false
    : isDisabled || isPreparingMessage || realtimeVoiceDisabled;

  return (
    <View style={styles.promptActions}>
      <View style={styles.promptActionsLeft}>
        <TouchableOpacity
          onPress={handleFileUpload}
          style={[
            styles.inlineIconButton,
            {
              opacity: disableAttachments ? 0.5 : 1,
              borderColor: disableAttachments
                ? 'rgba(255,255,255,0.2)'
                : 'rgba(59,130,246,0.25)',
            },
          ]}
          disabled={disableAttachments}
          accessibilityLabel="Attach file or image"
          accessibilityRole="button"
          accessibilityHint="Upload a file or image to include in your prompt"
        >
          <Icon
            name="Paperclip"
            size={20}
            color={disableAttachments ? 'rgba(255,255,255,0.35)' : '#ffffff'}
          />
        </TouchableOpacity>

        <PromptInputModelSelector
          shouldRender={shouldRenderModelSelector}
          isLoading={isModelSelectorLoading}
          isDisabled={isDisabled}
          isPreparingMessage={isPreparingMessage}
          isListening={isListening}
          isMenuOpen={isModelMenuOpen}
          setIsMenuOpen={setIsModelMenuOpen}
          options={modelOptions}
          userPlan={userPlan}
          currentLabel={currentModelLabel}
          effectiveModelId={effectiveModelId}
          onSelect={handleModelSelect}
          reasoningEffortLevels={reasoningEffortLevels}
          defaultReasoningEffort={defaultReasoningEffort}
          selectedReasoningEffort={selectedReasoningEffort}
          onReasoningEffortChange={onReasoningEffortChange}
          quickModeEnabled={quickModeEnabled}
          onQuickModeToggle={onQuickModeToggle}
          onCustomizeOrchestration={onCustomizeOrchestration}
          agentCount={agentCount}
          onAgentCountChange={onAgentCountChange}
        />
      </View>

      {isListening ? (
        <View style={styles.promptActionsRight}>
          <TouchableOpacity
            onPress={() => handleVoiceDictationCancel()}
            style={[
              styles.inlineIconButton,
              {
                backgroundColor: 'rgba(248,113,113,0.14)',
                borderColor: 'rgba(248,113,113,0.6)',
              },
            ]}
            accessibilityLabel="Cancel dictation"
            accessibilityRole="button"
            accessibilityHint="Cancel the current voice dictation"
          >
            <Icon name="X" size={18} color="#fca5a5" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => handleVoiceDictationAccept()}
            style={[
              styles.inlineIconButton,
              {
                backgroundColor: '#3b82f6',
                borderColor: '#3b82f6',
              },
            ]}
            accessibilityLabel="Finish dictation"
            accessibilityRole="button"
            accessibilityHint="Stop recording and transcribe the current dictation"
          >
            <Icon name="Check" size={18} color="#ffffff" />
          </TouchableOpacity>
        </View>
      ) : primaryAction.mode === 'send' ? (
        <TouchableOpacity
          onPress={() => handleSend()}
          style={[
            styles.inlineIconButton,
            {
              backgroundColor: '#3b82f6',
              borderColor: '#3b82f6',
              opacity: primaryAction.disabled ? 0.4 : 1,
            },
          ]}
          disabled={primaryAction.disabled}
          accessibilityLabel={primaryAction.title}
          accessibilityRole="button"
        >
          {isPreparingMessage ? (
            <Text className="text-2xl font-bold text-white">...</Text>
          ) : (
            <Icon name="Send" size={20} color="#ffffff" />
          )}
        </TouchableOpacity>
      ) : (
        <View style={styles.promptActionsRight}>
          <TouchableOpacity
            onPress={() => handleVoiceDictation()}
            style={voiceDictationButtonStyles}
            disabled={isDisabled || isPreparingMessage || realtimeVoiceActive}
            accessibilityLabel="Voice input"
            accessibilityRole="button"
            accessibilityHint="Use your voice to dictate a message"
          >
            <Icon name="Mic" size={20} color="#ffffff" />
          </TouchableOpacity>

          {shouldRenderRealtimeVoice && (
            <TouchableOpacity
              onPress={() => handleRealtimeVoice?.()}
              style={[
                styles.inlineIconButton,
                {
                  backgroundColor: realtimeVoiceActive ? '#0f172a' : '#0ea5e9',
                  borderColor: realtimeVoiceActive ? 'rgba(255,255,255,0.25)' : '#38bdf8',
                  opacity: liveVoiceDisabled ? 0.45 : 1,
                },
              ]}
              disabled={liveVoiceDisabled}
              accessibilityLabel={realtimeVoiceActive ? 'Stop voice conversation' : 'Use voice'}
              accessibilityRole="button"
              accessibilityHint={
                realtimeVoiceActive
                  ? 'End the current voice conversation'
                  : 'Start a realtime voice conversation'
              }
            >
              <Icon
                name={realtimeVoiceActive ? 'X' : 'AudioLines'}
                size={20}
                color="#ffffff"
              />
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}
