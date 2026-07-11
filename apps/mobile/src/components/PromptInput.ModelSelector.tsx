import { spacingTokens } from '@taskforceai/design-tokens';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Modal,
  ScrollView,
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
  reasoningEffortLevels: string[];
  defaultReasoningEffort: string | null;
  selectedReasoningEffort: string | null;
  onReasoningEffortChange: (effort: string) => void;
};

const formatReasoningEffortLabel = (effort: string): string =>
  effort === 'xhigh' ? 'Extra high' : effort.charAt(0).toUpperCase() + effort.slice(1);

const reasoningEffortDescription = (effort: string): string => {
  const descriptions: Record<string, string> = {
    minimal: 'Fastest replies for straightforward tasks.',
    low: 'Quick replies to simple questions.',
    medium: 'Light, casual tasks.',
    high: 'Balanced for everyday work.',
    xhigh: 'Complex, detailed work.',
    max: 'The hardest problems. Takes longest.',
  };
  return descriptions[effort] ?? 'Adjust response speed and depth.';
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
  reasoningEffortLevels,
  defaultReasoningEffort,
  selectedReasoningEffort,
  onReasoningEffortChange,
}: PromptInputModelSelectorProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [menuView, setMenuView] = useState<'models' | 'effort'>('models');

  useEffect(() => {
    if (!isMenuOpen) {
      setMenuView('models');
    }
  }, [isMenuOpen]);

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
        onRequestClose={() => {
          if (menuView === 'effort') {
            setMenuView('models');
            return;
          }
          setIsMenuOpen(false);
        }}
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
            <View style={styles.sheetHeader}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={menuView === 'models' ? 'Close model selector' : 'Back to models'}
                onPress={() => {
                  if (menuView === 'effort') {
                    setMenuView('models');
                    return;
                  }
                  setIsMenuOpen(false);
                }}
                style={[styles.headerButton, { borderColor: theme.colors.border }]}
              >
                <Icon
                  name={menuView === 'models' ? 'X' : 'ChevronLeft'}
                  size={18}
                  color={theme.colors.text}
                />
              </TouchableOpacity>
              <Text style={[styles.dropdownTitle, { color: theme.colors.text }]}>
                {menuView === 'models' ? 'Select Model' : 'Effort'}
              </Text>
              <View style={styles.headerSpacer} />
            </View>

            {menuView === 'models' ? (
              <>
                <ScrollView
                  style={styles.optionsScroll}
                  contentContainerStyle={styles.optionsContainer}
                  showsVerticalScrollIndicator={false}
                >
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
                        {isSelected ? (
                          <Icon name="Check" size={18} color={theme.colors.primary} />
                        ) : null}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>

                {reasoningEffortLevels.length > 0 && selectedReasoningEffort ? (
                  <TouchableOpacity
                    style={[
                      styles.effortTrigger,
                      {
                        borderColor: theme.colors.border,
                        backgroundColor: theme.colors.cardBackground,
                      },
                    ]}
                    onPress={() => setMenuView('effort')}
                    accessibilityRole="button"
                    accessibilityLabel={`Effort, ${formatReasoningEffortLabel(selectedReasoningEffort)}`}
                    accessibilityHint="Opens reasoning effort options"
                  >
                    <Text style={[styles.effortLabel, { color: theme.colors.text }]}>Effort</Text>
                    <View style={styles.effortTriggerValue}>
                      <Text style={styles.effortValue}>
                        {formatReasoningEffortLabel(selectedReasoningEffort)}
                      </Text>
                      <Icon name="ChevronRight" size={17} color="rgba(255,255,255,0.45)" />
                    </View>
                  </TouchableOpacity>
                ) : null}
              </>
            ) : (
              <ScrollView
                style={styles.effortList}
                contentContainerStyle={styles.effortListContent}
                showsVerticalScrollIndicator={false}
                accessibilityRole="radiogroup"
                accessibilityLabel="Reasoning effort"
              >
                {reasoningEffortLevels.map((effort) => {
                  const isSelected = effort === selectedReasoningEffort;
                  return (
                    <TouchableOpacity
                      key={effort}
                      onPress={() => onReasoningEffortChange(effort)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: isSelected }}
                      accessibilityLabel={`${formatReasoningEffortLabel(effort)} reasoning effort`}
                      style={[
                        styles.effortRow,
                        { borderBottomColor: theme.colors.border },
                      ]}
                    >
                      <View style={styles.effortRowText}>
                        <View style={styles.effortRowTitleLine}>
                          <Text style={[styles.effortRowTitle, { color: theme.colors.text }]}>
                            {formatReasoningEffortLabel(effort)}
                          </Text>
                          {effort === defaultReasoningEffort ? (
                            <Text style={styles.defaultLabel}>Default</Text>
                          ) : null}
                        </View>
                        <Text style={styles.effortDescription}>
                          {reasoningEffortDescription(effort)}
                        </Text>
                      </View>
                      {isSelected ? (
                        <Icon name="Check" size={19} color={theme.colors.primary} />
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
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
    paddingTop: spacingTokens.sm,
    paddingBottom: spacingTokens.md,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    marginBottom: spacingTokens.sm,
  },
  headerButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSpacer: {
    width: 34,
  },
  dropdownTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  optionsContainer: {
    gap: spacingTokens.xs,
  },
  optionsScroll: {
    maxHeight: 320,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: spacingTokens.md,
    paddingVertical: spacingTokens.sm,
  },
  optionText: {
    fontSize: 15,
    fontWeight: '600',
  },
  effortTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 14,
    marginTop: spacingTokens.sm,
    paddingHorizontal: spacingTokens.md,
  },
  effortLabel: {
    fontSize: 14,
    fontWeight: '700',
  },
  effortValue: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 13,
    fontWeight: '600',
  },
  effortTriggerValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  effortList: {
    maxHeight: 380,
  },
  effortListContent: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  effortRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacingTokens.sm,
    paddingVertical: spacingTokens.xs,
  },
  effortRowText: {
    flex: 1,
  },
  effortRowTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingTokens.xs,
  },
  effortRowTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  defaultLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 10,
    fontWeight: '600',
  },
  effortDescription: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    marginTop: 1,
  },
});
