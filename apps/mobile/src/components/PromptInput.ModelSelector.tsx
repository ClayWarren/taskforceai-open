import { spacingTokens } from '@taskforceai/design-tokens';
import type { ModelOptionSummary } from '@taskforceai/contracts/contracts';
import {
  buildPromptAgentCountOptions,
  canUseModelForPlan,
  getModelCostTier,
} from '@taskforceai/client-core';
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
import type { Theme } from '../theme/theme';
import { Icon } from './Icon';
import { ModelProviderLogo } from './ModelProviderLogo';

type PromptInputModelSelectorProps = {
  shouldRender: boolean;
  isLoading: boolean;
  isDisabled: boolean;
  isPreparingMessage: boolean;
  isListening: boolean;
  isMenuOpen: boolean;
  setIsMenuOpen: (next: boolean) => void;
  options: ModelOptionSummary[];
  userPlan?: string | null;
  currentLabel: string;
  effectiveModelId: string | null;
  onSelect: (modelId: string) => void;
  reasoningEffortLevels: string[];
  defaultReasoningEffort: string | null;
  selectedReasoningEffort: string | null;
  onReasoningEffortChange: (effort: string) => void;
  quickModeEnabled: boolean;
  onQuickModeToggle: () => void;
  onCustomizeOrchestration?: () => void;
  agentCount?: number;
  onAgentCountChange?: (count: number) => void;
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

function AgentModeOptions({
  theme,
  quickModeEnabled,
  onQuickModeToggle,
  onCustomizeOrchestration,
  agentCount,
  onAgentCountChange,
  userPlan,
  setIsMenuOpen,
}: {
  theme: Theme;
  quickModeEnabled: boolean;
  onQuickModeToggle: () => void;
  onCustomizeOrchestration?: () => void;
  agentCount?: number;
  onAgentCountChange?: (count: number) => void;
  userPlan?: string | null;
  setIsMenuOpen: (next: boolean) => void;
}) {
  const agentCountOptions = buildPromptAgentCountOptions(userPlan);
  const showTeamConfig = !quickModeEnabled;

  return (
    <ScrollView
      style={styles.effortList}
      contentContainerStyle={styles.modeContent}
      showsVerticalScrollIndicator={false}
    >
      {([true, false] as const).map((singleAgent) => {
        const isSelected = quickModeEnabled === singleAgent;
        const label = singleAgent ? 'Single Agent' : 'Agent Teams';
        const description = singleAgent
          ? 'One assistant handles the request.'
          : 'Multiple agents work in parallel.';
        return (
          <TouchableOpacity
            key={label}
            onPress={() => {
              if (!isSelected) onQuickModeToggle();
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={label}
            style={[
              styles.modeRow,
              {
                borderColor: isSelected ? theme.colors.primary : theme.colors.border,
                backgroundColor: isSelected
                  ? 'rgba(59,130,246,0.12)'
                  : theme.colors.cardBackground,
              },
            ]}
          >
            <View style={styles.modeRowText}>
              <Text style={[styles.optionText, { color: theme.colors.text }]}>{label}</Text>
              <Text style={styles.effortDescription}>{description}</Text>
            </View>
            {isSelected ? <Icon name="Check" size={19} color={theme.colors.primary} /> : null}
          </TouchableOpacity>
        );
      })}

      {showTeamConfig && agentCount !== undefined && onAgentCountChange ? (
        <View style={[styles.teamConfig, { borderColor: theme.colors.border }]}>
          <Text style={[styles.effortLabel, { color: theme.colors.text }]}>Parallel Agents</Text>
          <View style={styles.countGrid}>
            {agentCountOptions.map((count) => (
              <TouchableOpacity
                key={count}
                onPress={() => onAgentCountChange(count)}
                accessibilityRole="radio"
                accessibilityState={{ selected: agentCount === count }}
                accessibilityLabel={`${count} parallel agents`}
                style={[
                  styles.countButton,
                  { borderColor: theme.colors.border },
                  agentCount === count && {
                    backgroundColor: 'rgba(59,130,246,0.2)',
                    borderColor: theme.colors.primary,
                  },
                ]}
              >
                <Text style={[styles.countText, { color: theme.colors.text }]}>{count}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : null}

      {showTeamConfig && onCustomizeOrchestration ? (
        <TouchableOpacity
          style={[
            styles.effortTrigger,
            {
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.cardBackground,
              marginTop: 0,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Custom Models"
          accessibilityHint="Assign models to agent roles"
          onPress={() => {
            setIsMenuOpen(false);
            setTimeout(() => onCustomizeOrchestration(), 250);
          }}
        >
          <Text style={[styles.effortLabel, { color: theme.colors.text }]}>Custom Models</Text>
          <Icon name="ChevronRight" size={17} color="rgba(255,255,255,0.45)" />
        </TouchableOpacity>
      ) : null}
    </ScrollView>
  );
}

export function PromptInputModelSelector({
  shouldRender,
  isLoading,
  isDisabled,
  isPreparingMessage,
  isListening,
  isMenuOpen,
  setIsMenuOpen,
  options,
  userPlan,
  currentLabel,
  effectiveModelId,
  onSelect,
  reasoningEffortLevels,
  defaultReasoningEffort,
  selectedReasoningEffort,
  onReasoningEffortChange,
  quickModeEnabled,
  onQuickModeToggle,
  onCustomizeOrchestration,
  agentCount,
  onAgentCountChange,
}: PromptInputModelSelectorProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [menuView, setMenuView] = useState<'models' | 'effort' | 'mode'>('models');

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
          if (menuView !== 'models') {
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
                  if (menuView !== 'models') {
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
                {menuView === 'models'
                  ? 'Select Model'
                  : menuView === 'effort'
                    ? 'Effort'
                    : 'Agent Mode'}
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
                    const isLocked = !canUseModelForPlan(userPlan, option.usageMultiple);
                    const costTier = getModelCostTier(option.usageMultiple);
                    return (
                      <TouchableOpacity
                        key={option.id}
                        onPress={() => {
                          if (isLocked) return;
                          onSelect(option.id);
                          setIsMenuOpen(false);
                        }}
                        disabled={isLocked}
                        accessibilityState={{ disabled: isLocked, selected: isSelected }}
                        accessibilityLabel={`${option.label}${isLocked ? ', Pro subscription required' : ''}`}
                        style={[
                          styles.optionRow,
                          {
                            borderColor: isSelected ? theme.colors.primary : theme.colors.border,
                            backgroundColor: isSelected
                              ? 'rgba(59,130,246,0.12)'
                              : theme.colors.cardBackground,
                            opacity: isLocked ? 0.55 : 1,
                          },
                        ]}
                      >
                        <View style={styles.optionIdentity}>
                          <ModelProviderLogo modelId={option.id} modelLabel={option.label} />
                          <Text
                            style={[
                              styles.optionText,
                              { color: isSelected ? theme.colors.primary : theme.colors.text },
                            ]}
                            numberOfLines={1}
                          >
                            {option.label}
                          </Text>
                        </View>
                        <View style={styles.optionMetadata}>
                          {costTier ? (
                            <Text style={[styles.costTier, { color: theme.colors.success }]}>
                              {costTier.symbol}
                            </Text>
                          ) : null}
                          {isLocked ? (
                            <View style={styles.lockLabel}>
                              <Icon name="Lock" size={13} color="#fbbf24" />
                              <Text style={styles.lockText}>Pro</Text>
                            </View>
                          ) : isSelected ? (
                            <Icon name="Check" size={18} color={theme.colors.primary} />
                          ) : null}
                        </View>
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
                <TouchableOpacity
                  style={[
                    styles.effortTrigger,
                    {
                      borderColor: theme.colors.border,
                      backgroundColor: theme.colors.cardBackground,
                    },
                  ]}
                  onPress={() => setMenuView('mode')}
                  accessibilityRole="button"
                  accessibilityLabel={`Agent mode, ${quickModeEnabled ? 'Single Agent' : 'Agent Teams'}`}
                  accessibilityHint="Opens single agent and agent team options"
                >
                  <Text style={[styles.effortLabel, { color: theme.colors.text }]}>Agent Mode</Text>
                  <View style={styles.effortTriggerValue}>
                    <Text style={styles.effortValue}>
                      {quickModeEnabled ? 'Single Agent' : 'Agent Teams'}
                    </Text>
                    <Icon name="ChevronRight" size={17} color="rgba(255,255,255,0.45)" />
                  </View>
                </TouchableOpacity>
              </>
            ) : menuView === 'effort' ? (
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
            ) : (
              <AgentModeOptions
                theme={theme}
                quickModeEnabled={quickModeEnabled}
                onQuickModeToggle={onQuickModeToggle}
                onCustomizeOrchestration={onCustomizeOrchestration}
                agentCount={agentCount}
                onAgentCountChange={onAgentCountChange}
                userPlan={userPlan}
                setIsMenuOpen={setIsMenuOpen}
              />
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
    flexShrink: 1,
  },
  optionIdentity: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingTokens.sm,
  },
  optionMetadata: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  costTier: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  lockLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  lockText: {
    color: '#fbbf24',
    fontSize: 11,
    fontWeight: '700',
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
  modeContent: {
    gap: spacingTokens.sm,
  },
  modeRow: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 64,
    paddingHorizontal: spacingTokens.md,
    paddingVertical: spacingTokens.sm,
  },
  modeRowText: { flex: 1 },
  teamConfig: {
    borderRadius: 14,
    borderWidth: 1,
    gap: spacingTokens.sm,
    padding: spacingTokens.md,
  },
  countGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacingTokens.xs },
  countButton: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 38,
    minWidth: 44,
  },
  countText: { fontSize: 14, fontWeight: '600' },
});
