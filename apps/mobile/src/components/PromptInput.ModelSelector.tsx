import { spacingTokens } from '@taskforceai/design-tokens';
import {
  ActivityIndicator,
  Keyboard,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../contexts/ThemeContext';
import { Icon } from './Icon';

type ModelOption = {
  id: string;
  label: string;
};

type PromptInputModelSelectorProps = {
  shouldRender: boolean;
  isLoading: boolean;
  isDisabled: boolean;
  isPreparingMessage: boolean;
  isListening: boolean;
  isMenuOpen: boolean;
  setIsMenuOpen: (next: boolean) => void;
  options: ModelOption[];
  currentLabel: string;
  effectiveModelId: string | null;
  onSelect: (modelId: string) => void;
};

export function PromptInputModelSelector({
  shouldRender,
  isLoading,
  isDisabled,
  isPreparingMessage,
  isListening,
  isMenuOpen,
  setIsMenuOpen,
  options,
  currentLabel,
  effectiveModelId,
  onSelect,
}: PromptInputModelSelectorProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  if (!shouldRender) {
    return null;
  }

  const disabled = isDisabled || isPreparingMessage || isListening || options.length === 0;

  return (
    <View style={styles.modelSelectorWrapper}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Select AI model"
        accessibilityHint="Opens a menu to switch the active model"
        onPress={() => {
          if (disabled || isLoading) return;
          Keyboard.dismiss();
          setTimeout(() => {
            setIsMenuOpen(true);
          }, 60);
        }}
        activeOpacity={0.85}
        style={[
          styles.modelSelectorButton,
          {
            borderColor: isMenuOpen ? theme.colors.primary : 'rgba(255,255,255,0.18)',
            opacity: disabled || isLoading ? 0.6 : 1,
          },
        ]}
        disabled={disabled}
      >
        {isLoading ? (
          <ActivityIndicator size="small" color={theme.colors.primary} />
        ) : (
          <>
            <Text style={styles.modelSelectorLabel} numberOfLines={1}>
              {currentLabel}
            </Text>
            <View style={styles.modelSelectorChevron}>
              <Icon name="ChevronUp" size={16} color="#ffffff" />
            </View>
          </>
        )}
      </TouchableOpacity>

      <Modal
        visible={isMenuOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setIsMenuOpen(false)}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setIsMenuOpen(false)}
          style={[styles.overlay, { backgroundColor: theme.colors.overlay }]}
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => {
              return;
            }}
            style={[
              styles.dropdownCard,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
                marginBottom: Math.max(insets.bottom, spacingTokens.md) + 108,
              },
            ]}
          >
            <Text style={[styles.dropdownTitle, { color: theme.colors.text }]}>Select Model</Text>
            <View style={styles.optionsContainer}>
              {options.map((option) => {
                const isSelected = option.id === effectiveModelId;
                return (
                  <TouchableOpacity
                    key={option.id}
                    onPress={() => {
                      onSelect(option.id);
                      setIsMenuOpen(false);
                    }}
                    style={[
                      styles.optionRow,
                      {
                        borderColor: isSelected ? theme.colors.primary : theme.colors.border,
                        backgroundColor: isSelected
                          ? 'rgba(59,130,246,0.12)'
                          : theme.colors.cardBackground,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.optionText,
                        { color: isSelected ? theme.colors.primary : theme.colors.text },
                      ]}
                      numberOfLines={1}
                    >
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  modelSelectorWrapper: {
    position: 'relative',
    flexShrink: 0,
    alignSelf: 'center',
  },
  modelSelectorButton: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacingTokens.sm,
    height: 36,
    minWidth: 88,
    backgroundColor: 'rgba(17,25,48,0.9)',
    borderColor: 'rgba(59,130,246,0.3)',
  },
  modelSelectorLabel: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
  modelSelectorChevron: {
    marginLeft: spacingTokens.xs,
  },
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  dropdownCard: {
    alignSelf: 'center',
    width: '88%',
    maxWidth: 420,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: spacingTokens.md,
    paddingVertical: spacingTokens.md,
  },
  dropdownTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: spacingTokens.sm,
  },
  optionsContainer: {
    gap: spacingTokens.xs,
  },
  optionRow: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: spacingTokens.md,
    paddingVertical: spacingTokens.sm,
  },
  optionText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
