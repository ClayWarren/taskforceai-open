import { spacingTokens } from '@taskforceai/design-tokens';
import type { ModelOptionSummary } from '@taskforceai/contracts/contracts';
import { getAgentRoleSlots } from '@taskforceai/shared';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { Icon } from './Icon';

interface OrchestrationRoleGridProps {
  models: ModelOptionSummary[];
  roleModels: Record<string, string>;
  defaultModelId: string | null;
  agentCount?: number;
  expandedRole: string | null;
  onRolePress: (_roleId: string) => void;
  onRoleModelChange: (_roleId: string, _modelId: string) => void;
}

export function OrchestrationRoleGrid({
  models,
  roleModels,
  defaultModelId,
  agentCount,
  expandedRole,
  onRolePress,
  onRoleModelChange,
}: OrchestrationRoleGridProps) {
  const roleSlots = getAgentRoleSlots(agentCount);

  return (
    <View style={styles.rolesGrid}>
      {roleSlots.map((role) => {
        const currentModelId = roleModels[role.id] || defaultModelId;
        const currentModel = models.find((m) => m.id === currentModelId);
        const isExpanded = expandedRole === role.id;

        return (
          <View key={role.id} style={styles.roleCard}>
            <TouchableOpacity
              style={styles.roleHeader}
              onPress={() => onRolePress(role.id)}
              activeOpacity={0.7}
            >
              <Text style={styles.roleLabel}>{role.label}</Text>
              <View style={styles.roleModelRow}>
                <Text style={styles.roleModel} numberOfLines={1}>
                  {currentModel?.label || 'Select model'}
                </Text>
                <Icon
                  name={isExpanded ? 'ChevronUp' : 'ChevronDown'}
                  size={16}
                  color="rgba(255,255,255,0.5)"
                />
              </View>
              <Text style={styles.roleDescription}>{role.description}</Text>
            </TouchableOpacity>

            {isExpanded && (
              <View style={styles.roleOptions}>
                {models.map((model) => (
                  <TouchableOpacity
                    key={model.id}
                    style={[
                      styles.modelOption,
                      currentModelId === model.id && styles.modelOptionSelected,
                    ]}
                    onPress={() => onRoleModelChange(role.id, model.id)}
                  >
                    <Text
                      style={[
                        styles.modelOptionText,
                        currentModelId === model.id && styles.modelOptionTextSelected,
                      ]}
                      numberOfLines={1}
                    >
                      {model.label}
                    </Text>
                    {model.badge && <Text style={styles.modelBadge}>{model.badge}</Text>}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  rolesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: spacingTokens.sm,
  },
  roleCard: {
    width: '48%',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    overflow: 'hidden',
  },
  roleHeader: {
    padding: spacingTokens.sm,
  },
  roleLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 1,
    marginBottom: 4,
  },
  roleModelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  roleModel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
    flex: 1,
  },
  roleDescription: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
  },
  roleOptions: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
    padding: spacingTokens.xs,
  },
  modelOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacingTokens.xs,
    paddingHorizontal: spacingTokens.xs,
    borderRadius: 6,
    marginBottom: 2,
  },
  modelOptionSelected: {
    backgroundColor: 'rgba(59,130,246,0.2)',
  },
  modelOptionText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
    flex: 1,
  },
  modelOptionTextSelected: {
    color: '#ffffff',
    fontWeight: '600',
  },
  modelBadge: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.5)',
    marginLeft: 4,
  },
});
