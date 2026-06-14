import { spacingTokens } from '@taskforceai/design-tokens';
import type { ModelOptionSummary } from '@taskforceai/contracts/contracts';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { buildPromptAgentCountOptions } from '@taskforceai/shared';

import { useTheme } from '../contexts/ThemeContext';
import { BudgetInputField } from './BudgetInputField';
import { OrchestrationRoleGrid } from './OrchestrationRoleGrid';
import { PanelSheet } from './PanelSheet';

interface OrchestrationModalProps {
  visible: boolean;
  onClose: () => void;
  models: ModelOptionSummary[];
  roleModels: Record<string, string>;
  onRoleModelChange: (role: string, modelId: string) => void;
  budget?: number;
  onBudgetChange: (budget: number | undefined) => void;
  autonomyEnabled: boolean;
  defaultModelId: string | null;
  defaultModelLabel: string | null;
  userPlan?: string | null;
  agentCount?: number;
  onAgentCountChange?: (count: number) => void;
}

export function OrchestrationModal({
  visible,
  onClose,
  models,
  roleModels,
  onRoleModelChange,
  budget,
  onBudgetChange,
  autonomyEnabled,
  defaultModelId,
  defaultModelLabel,
  userPlan,
  agentCount = 4,
  onAgentCountChange,
}: OrchestrationModalProps) {
  const { theme } = useTheme();
  const [expandedRole, setExpandedRole] = useState<string | null>(null);

  const handleRolePress = (roleId: string) => {
    setExpandedRole(expandedRole === roleId ? null : roleId);
  };

  const agentCountOptions = buildPromptAgentCountOptions(userPlan);

  return (
    <PanelSheet
      visible={visible}
      onClose={onClose}
      title="Custom Orchestration"
      description={
        autonomyEnabled
          ? 'Assign specialized models and set a mission budget.'
          : 'Assign specialized models to each agent role.'
      }
      height="80%"
    >
      <View style={styles.section}>
        <View style={styles.configRow}>
          <View style={[styles.miniCard, { borderColor: 'rgba(59,130,246,0.5)' }]}>
            <Text style={styles.miniLabel}>BOSS / DEFAULT</Text>
            <Text style={styles.miniValue} numberOfLines={1}>
              {defaultModelLabel || 'Default'}
            </Text>
          </View>

          <View style={[styles.miniCard, { borderColor: 'rgba(168,85,247,0.5)' }]}>
            <Text style={styles.miniLabel}>PARALLEL AGENTS</Text>
            <View style={styles.countControls}>
              <Text style={styles.miniValue}>{agentCount}</Text>
            </View>
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.countOptions}
        >
          {agentCountOptions.map((n) => (
            <TouchableOpacity
              key={n}
              onPress={() => onAgentCountChange?.(n)}
              style={[
                styles.countOption,
                agentCount === n && {
                  backgroundColor: 'rgba(168,85,247,0.2)',
                  borderColor: 'rgba(168,85,247,0.5)',
                },
              ]}
            >
              <Text
                style={[
                  styles.countOptionText,
                  agentCount === n && { color: '#ffffff', fontWeight: 'bold' },
                ]}
              >
                {n}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {autonomyEnabled && (
        <View style={styles.section}>
          <View style={[styles.budgetCard, { borderColor: 'rgba(16,185,129,0.5)' }]}>
            <BudgetInputField
              label="ORGANIZATION BUDGET"
              placeholder="Auto"
              value={budget}
              onChange={onBudgetChange}
            />
          </View>
        </View>
      )}

      <View style={styles.splitter}>
        <View style={styles.splitterLine} />
        <View style={styles.splitterDot} />
      </View>

      <OrchestrationRoleGrid
        models={models}
        roleModels={roleModels}
        defaultModelId={defaultModelId}
        agentCount={agentCount}
        expandedRole={expandedRole}
        onRolePress={handleRolePress}
        onRoleModelChange={(roleId, modelId) => {
          onRoleModelChange(roleId, modelId);
          setExpandedRole(null);
        }}
      />

      <View style={styles.splitter}>
        <View style={styles.splitterLine} />
        <View style={styles.splitterDot} />
      </View>

      <View style={styles.section}>
        <View style={styles.configRow}>
          <View style={[styles.miniCard, { borderColor: 'rgba(59,130,246,0.5)' }]}>
            <Text style={styles.miniLabel}>FINAL RESULT</Text>
            <Text style={styles.miniValue} numberOfLines={1}>
              {defaultModelLabel || 'Default'}
            </Text>
          </View>
        </View>
        <TouchableOpacity
          onPress={onClose}
          style={[styles.applyButton, { backgroundColor: theme.colors.primary }]}
        >
          <Text style={styles.applyButtonText}>APPLY CONFIGURATION</Text>
        </TouchableOpacity>
      </View>
    </PanelSheet>
  );
}

const styles = StyleSheet.create({
  section: {
    alignItems: 'center',
    marginBottom: spacingTokens.sm,
  },
  configRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacingTokens.sm,
    width: '100%',
    marginBottom: spacingTokens.sm,
  },
  miniCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.03)',
    padding: spacingTokens.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 1,
    marginBottom: 4,
  },
  miniValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  countControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingTokens.sm,
  },
  countOptions: {
    paddingHorizontal: 4,
    gap: spacingTokens.xs,
    paddingVertical: 4,
  },
  countOption: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countOptionText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
  },
  budgetCard: {
    width: '80%',
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: 'rgba(16,185,129,0.1)',
    padding: spacingTokens.md,
  },
  splitter: {
    alignItems: 'center',
    marginVertical: spacingTokens.sm,
  },
  splitterLine: {
    width: '60%',
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  splitterDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.2)',
    marginTop: -4,
  },
  applyButton: {
    width: '100%',
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacingTokens.md,
    marginBottom: spacingTokens.md,
  },
  applyButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
});
