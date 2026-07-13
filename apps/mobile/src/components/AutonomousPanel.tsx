import { spacingTokens } from '@taskforceai/design-tokens';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { calculateBudgetStats } from '@taskforceai/client-core';
import { getBudgetColor } from '@taskforceai/presenters';

import { BudgetInputField } from './BudgetInputField';
import { PanelSheet } from './PanelSheet';

interface AutonomousPanelProps {
  visible: boolean;
  onClose: () => void;
  budget?: number;
  onBudgetChange: (budget: number | undefined) => void;
  currentSpend?: number;
  budgetLimit?: number | null;
  isStreaming?: boolean;
}

export function AutonomousPanel({
  visible,
  onClose,
  budget,
  onBudgetChange,
  currentSpend = 0,
  budgetLimit = null,
  isStreaming = false,
}: AutonomousPanelProps) {
  const { effectiveBudget, budgetPercentage, remaining } = calculateBudgetStats(
    currentSpend,
    budget,
    budgetLimit
  );

  return (
    <PanelSheet
      visible={visible}
      onClose={onClose}
      title="Autonomous Mode"
      titleIcon="🤖"
      description="Set a budget limit for autonomous task execution."
      height="70%"
      closeTestID="close-panel-btn"
    >
      <View style={styles.section}>
        <BudgetInputField
          label="BUDGET LIMIT"
          placeholder="No limit"
          value={budget}
          onChange={onBudgetChange}
        />
        <Text style={styles.hint}>
          The autonomous organization will stop when this limit is reached.
        </Text>
      </View>

      {isStreaming && (
        <View style={styles.spendCard}>
          <View style={styles.spendHeader}>
            <Text style={styles.label}>CURRENT SPEND</Text>
            <Text style={styles.spendAmount}>${currentSpend.toFixed(2)}</Text>
          </View>

          {effectiveBudget !== undefined && effectiveBudget !== null && effectiveBudget > 0 && (
            <>
              <View style={styles.progressBar}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${budgetPercentage}%`,
                      backgroundColor: getBudgetColor(budgetPercentage),
                    },
                  ]}
                />
              </View>
              <View style={styles.spendDetails}>
                <Text style={styles.spendDetailText}>${currentSpend.toFixed(2)} spent</Text>
                <Text style={styles.spendDetailText}>${remaining?.toFixed(2)} remaining</Text>
              </View>
            </>
          )}

          {(effectiveBudget === undefined || effectiveBudget === null) && (
            <Text style={styles.unlimitedText}>No budget limit set. Running until task completes.</Text>
          )}
        </View>
      )}

      <View style={styles.infoCard}>
        <Text style={styles.infoText}>
          <Text style={styles.infoBold}>Autonomous Mode</Text>
          {' '}enables persistent, self-directed task execution. The AI organization will work
          independently until your goal is achieved or the budget is exhausted.
        </Text>
      </View>
    </PanelSheet>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: spacingTokens.lg,
  },
  label: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 1,
    marginBottom: spacingTokens.xs,
  },
  hint: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    marginTop: spacingTokens.xs,
  },
  spendCard: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: spacingTokens.md,
    marginBottom: spacingTokens.lg,
  },
  spendHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacingTokens.sm,
  },
  spendAmount: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ffffff',
  },
  progressBar: {
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
    marginBottom: spacingTokens.xs,
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  spendDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  spendDetailText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
  },
  unlimitedText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    marginTop: spacingTokens.xs,
  },
  infoCard: {
    backgroundColor: 'rgba(59,130,246,0.1)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.3)',
    padding: spacingTokens.md,
    marginBottom: spacingTokens.lg,
  },
  infoText: {
    fontSize: 13,
    color: 'rgba(59,130,246,0.8)',
    lineHeight: 18,
  },
  infoBold: {
    fontWeight: '700',
  },
});
