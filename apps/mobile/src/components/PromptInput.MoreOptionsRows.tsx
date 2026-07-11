import { PROMPT_OPTION_LABELS } from "@taskforceai/presenters";
import { Switch, Text, TouchableOpacity, View } from "react-native";

import { Icon } from "./Icon";
import { styles } from "./PromptInput.MoreOptionsSheet.styles";

export interface ToggleOption {
  key: string;
  label: string;
  description: string;
  iconName: "Zap" | "Activity" | "Cpu";
  enabled: boolean;
  onToggle: () => void;
}

interface ModeToggleRowProps {
  option: ToggleOption;
  primaryColor: string;
}

export function ModeToggleRow({ option, primaryColor }: ModeToggleRowProps) {
  return (
    <TouchableOpacity
      style={styles.optionRow}
      onPress={option.onToggle}
      activeOpacity={0.7}
      accessibilityRole="switch"
      accessibilityState={{ checked: option.enabled }}
      accessibilityLabel={`${option.label}. ${option.description}`}
    >
      <View style={styles.optionLeft}>
        <View
          style={[
            styles.iconContainer,
            {
              backgroundColor: option.enabled
                ? "rgba(59,130,246,0.2)"
                : "rgba(255,255,255,0.05)",
            },
          ]}
        >
          <Icon
            name={option.iconName}
            size={18}
            color={option.enabled ? primaryColor : "rgba(255,255,255,0.5)"}
          />
        </View>
        <View style={styles.optionText}>
          <Text style={styles.optionLabel}>{option.label}</Text>
          <Text style={styles.optionDescription}>{option.description}</Text>
        </View>
      </View>
      <Switch
        value={option.enabled}
        onValueChange={option.onToggle}
        trackColor={{ false: "rgba(255,255,255,0.1)", true: primaryColor }}
        thumbColor={option.enabled ? "#ffffff" : "rgba(255,255,255,0.6)"}
        ios_backgroundColor="rgba(255,255,255,0.1)"
      />
    </TouchableOpacity>
  );
}

interface AgentCountSectionProps {
  agentCount: number;
  agentCountOptions: number[];
  borderColor: string;
  onAgentCountChange: (count: number) => void;
}

export function AgentCountSection({
  agentCount,
  agentCountOptions,
  borderColor,
  onAgentCountChange,
}: AgentCountSectionProps) {
  return (
    <>
      <View style={[styles.divider, { backgroundColor: borderColor }]} />
      <View style={styles.agentCountSection}>
        <View style={styles.optionLeft}>
          <View
            style={[
              styles.iconContainer,
              { backgroundColor: "rgba(168,85,247,0.2)" },
            ]}
          >
            <Icon name="Users" size={18} color="#a855f7" />
          </View>
          <View style={styles.optionText}>
            <Text style={styles.optionLabel}>
              {PROMPT_OPTION_LABELS.parallelAgents}: {agentCount}
            </Text>
          </View>
        </View>
        <View style={styles.countGrid}>
          {agentCountOptions.map((count) => (
            <TouchableOpacity
              key={count}
              onPress={() => onAgentCountChange(count)}
              style={[
                styles.countButton,
                agentCount === count && {
                  backgroundColor: "rgba(168,85,247,0.3)",
                  borderColor: "rgba(168,85,247,0.5)",
                },
              ]}
            >
              <Text
                style={[
                  styles.countButtonText,
                  agentCount === count && {
                    color: "#ffffff",
                    fontWeight: "bold",
                  },
                ]}
              >
                {count}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </>
  );
}

interface ActionOptionRowProps {
  accessibilityLabel: string;
  description: string;
  iconColor: string;
  iconName: "Activity" | "Cpu";
  iconTint: string;
  label: string;
  onPress: () => void;
}

export function ActionOptionRow({
  accessibilityLabel,
  description,
  iconColor,
  iconName,
  iconTint,
  label,
  onPress,
}: ActionOptionRowProps) {
  return (
    <TouchableOpacity
      style={styles.optionRow}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <View style={styles.optionLeft}>
        <View style={[styles.iconContainer, { backgroundColor: iconTint }]}>
          <Icon name={iconName} size={18} color={iconColor} />
        </View>
        <View style={styles.optionText}>
          <Text style={styles.optionLabel}>{label}</Text>
          <Text style={styles.optionDescription}>{description}</Text>
        </View>
      </View>
      <Icon name="ChevronDown" size={18} color="rgba(255,255,255,0.4)" />
    </TouchableOpacity>
  );
}
