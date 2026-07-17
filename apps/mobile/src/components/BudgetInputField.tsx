import { spacingTokens } from '@taskforceai/design-tokens';
import { parsePromptBudgetInput } from '@taskforceai/client-core';
import { StyleSheet, Text, TextInput, View } from 'react-native';

interface BudgetInputFieldProps {
  label: string;
  placeholder: string;
  value?: number;
  onChange: (budget: number | undefined) => void;
}

export function BudgetInputField({ label, placeholder, value, onChange }: BudgetInputFieldProps) {
  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputContainer}>
        <Text style={styles.dollarSign}>$</Text>
        <TextInput
          style={styles.input}
          value={value === undefined ? '' : value.toString()}
          onChangeText={(text) => {
            if (text === '') {
              onChange(undefined);
              return;
            }
            const budgetValue = parsePromptBudgetInput(text);
            if (budgetValue === null) return;
            onChange(budgetValue);
          }}
          placeholder={placeholder}
          placeholderTextColor="rgba(255,255,255,0.3)"
          keyboardType="decimal-pad"
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 1,
    marginBottom: spacingTokens.xs,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: spacingTokens.md,
  },
  dollarSign: {
    fontSize: 20,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.7)',
    marginRight: 4,
  },
  input: {
    flex: 1,
    fontSize: 20,
    fontWeight: '500',
    color: '#ffffff',
    paddingVertical: spacingTokens.md,
  },
});
