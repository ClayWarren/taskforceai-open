import type { resolvePromptPrimaryAction } from '@taskforceai/shared';
import type { StyleProp, ViewStyle } from 'react-native';
import { Text, TouchableOpacity, View } from 'react-native';

import { Icon } from './Icon';
import { PromptInputModelSelector } from './PromptInput.ModelSelector';
import { styles } from './PromptInput.styles';

type PrimaryAction = ReturnType<typeof resolvePromptPrimaryAction>;

interface PromptInputActionsProps {
  currentModelLabel: string;
  disableAttachments: boolean;
  effectiveModelId: string | null;
  handleFileUpload: () => void;
  handleModelSelect: (modelId: string) => void;
  handleSend: () => void;
  handleVoiceDictation: () => void;
  isDisabled: boolean;
  isListening: boolean;
  isModelMenuOpen: boolean;
  isModelSelectorLoading: boolean;
  isPreparingMessage: boolean;
  modelOptions: Array<{ id: string; label: string }>;
  primaryAction: PrimaryAction;
  setIsModelMenuOpen: (next: boolean) => void;
  setIsMoreOptionsOpen: (next: boolean) => void;
  shouldRenderModelSelector: boolean;
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
  isDisabled,
  isListening,
  isModelMenuOpen,
  isModelSelectorLoading,
  isPreparingMessage,
  modelOptions,
  primaryAction,
  setIsModelMenuOpen,
  setIsMoreOptionsOpen,
  shouldRenderModelSelector,
  voiceDictationButtonStyles,
}: PromptInputActionsProps) {
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

        <TouchableOpacity
          onPress={() => setIsMoreOptionsOpen(true)}
          style={[styles.inlineIconButton, { borderColor: 'rgba(255,255,255,0.25)' }]}
          accessibilityLabel="More options"
          accessibilityRole="button"
          accessibilityHint="Open options for Direct Chat, Autonomous, and Computer Use"
        >
          <Icon name="MoreHorizontal" size={18} color="#ffffff" />
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
          currentLabel={currentModelLabel}
          effectiveModelId={effectiveModelId}
          onSelect={handleModelSelect}
        />
      </View>

      {primaryAction.mode === 'send' ? (
        <TouchableOpacity
          onPress={() => handleSend()}
          style={[
            styles.inlineIconButton,
            {
              backgroundColor: '#3b82f6',
              borderColor: '#3b82f6',
              opacity: isDisabled || isPreparingMessage || isListening ? 0.4 : 1,
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
        <TouchableOpacity
          onPress={() => handleVoiceDictation()}
          style={voiceDictationButtonStyles}
          disabled={isDisabled || isPreparingMessage}
          accessibilityLabel={isListening ? 'Stop recording' : 'Voice input'}
          accessibilityRole="button"
          accessibilityHint={isListening ? 'Stop listening and transcribe' : 'Use your voice to dictate a message'}
        >
          {isListening ? (
            <Icon name="Square" size={18} color="#f87171" />
          ) : (
            <Icon name="Mic" size={20} color="#ffffff" />
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}
