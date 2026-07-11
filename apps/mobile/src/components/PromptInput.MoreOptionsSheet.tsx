import { spacingTokens } from "@taskforceai/design-tokens";
import { buildPromptAgentCountOptions } from "@taskforceai/client-core";
import {
  PROMPT_MODE_DEFINITIONS,
  PROMPT_OPTION_LABELS,
} from "@taskforceai/presenters";
import React from "react";
import { Modal, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "../contexts/ThemeContext";
import {
  ActionOptionRow,
  AgentCountSection,
  ModeToggleRow,
  type ToggleOption,
} from "./PromptInput.MoreOptionsRows";
import { styles } from "./PromptInput.MoreOptionsSheet.styles";

interface MoreOptionsSheetProps {
  visible: boolean;
  onClose: () => void;
  quickModeEnabled: boolean;
  onQuickModeToggle: () => void;
  autonomousModeEnabled: boolean;
  onAutonomousModeToggle: () => void;
  computerUseEnabled: boolean;
  onComputerUseToggle: () => void;
  onCustomizeOrchestration?: () => void;
  onSetBudget?: () => void;
  autonomyEnabled?: boolean;
  agentCount?: number;
  onAgentCountChange?: (count: number) => void;
  userPlan?: string | null;
}

export function MoreOptionsSheet({
  visible,
  onClose,
  quickModeEnabled,
  onQuickModeToggle,
  autonomousModeEnabled,
  onAutonomousModeToggle,
  computerUseEnabled,
  onComputerUseToggle,
  onCustomizeOrchestration,
  onSetBudget,
  autonomyEnabled: _autonomyEnabled,
  agentCount,
  onAgentCountChange,
  userPlan,
}: MoreOptionsSheetProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  const options: ToggleOption[] = [
    {
      key: "autonomous",
      label: PROMPT_MODE_DEFINITIONS.autonomous.label,
      description: PROMPT_MODE_DEFINITIONS.autonomous.description,
      iconName: "Activity",
      enabled: autonomousModeEnabled,
      onToggle: onAutonomousModeToggle,
    },
    {
      key: "quickMode",
      label: PROMPT_MODE_DEFINITIONS.quickMode.label,
      description: PROMPT_MODE_DEFINITIONS.quickMode.description,
      iconName: "Zap",
      enabled: quickModeEnabled,
      onToggle: onQuickModeToggle,
    },
    {
      key: "computerUse",
      label: PROMPT_MODE_DEFINITIONS.computerUse.label,
      description: PROMPT_MODE_DEFINITIONS.computerUse.description,
      iconName: "Cpu",
      enabled: computerUseEnabled,
      onToggle: onComputerUseToggle,
    },
  ];

  const showCustomModels = !!onCustomizeOrchestration;
  const showBudgetOption = autonomousModeEnabled && onSetBudget;
  const showAgentCount =
    !quickModeEnabled && agentCount !== undefined && onAgentCountChange;

  const agentCountOptions = buildPromptAgentCountOptions(userPlan);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <TouchableOpacity
        activeOpacity={1}
        onPress={onClose}
        style={[styles.overlay, { backgroundColor: theme.colors.overlay }]}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => {
            return;
          }}
          style={[
            styles.card,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              marginBottom: Math.max(insets.bottom, spacingTokens.md) + 80,
            },
          ]}
        >
          <Text style={[styles.cardTitle, { color: theme.colors.text }]}>
            Options
          </Text>

          <View style={styles.content}>
            {options.map((option) => (
              <ModeToggleRow
                key={option.key}
                option={option}
                primaryColor={theme.colors.primary}
              />
            ))}

            {showAgentCount && (
              <AgentCountSection
                agentCount={agentCount}
                agentCountOptions={agentCountOptions}
                borderColor={theme.colors.border}
                onAgentCountChange={onAgentCountChange}
              />
            )}

            {showCustomModels && (
              <>
                <View
                  style={[
                    styles.divider,
                    { backgroundColor: theme.colors.border },
                  ]}
                />
                <ActionOptionRow
                  accessibilityLabel={`${PROMPT_OPTION_LABELS.customModels} - ${PROMPT_OPTION_LABELS.assignAgentModels}`}
                  description={PROMPT_OPTION_LABELS.assignAgentModels}
                  iconColor="#8b5cf6"
                  iconName="Cpu"
                  iconTint="rgba(139,92,246,0.2)"
                  label={PROMPT_OPTION_LABELS.customModels}
                  onPress={() => {
                    onClose();
                    setTimeout(() => onCustomizeOrchestration(), 350);
                  }}
                />
              </>
            )}

            {showBudgetOption && (
              <>
                <View
                  style={[
                    styles.divider,
                    { backgroundColor: theme.colors.border },
                  ]}
                />
                <ActionOptionRow
                  accessibilityLabel={`${PROMPT_OPTION_LABELS.setBudget} - Configure autonomous spending limit`}
                  description={PROMPT_OPTION_LABELS.configureSpendingLimit}
                  iconColor="#10b981"
                  iconName="Activity"
                  iconTint="rgba(16,185,129,0.2)"
                  label={PROMPT_OPTION_LABELS.setBudget}
                  onPress={() => {
                    onClose();
                    setTimeout(() => onSetBudget(), 350);
                  }}
                />
              </>
            )}
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}
