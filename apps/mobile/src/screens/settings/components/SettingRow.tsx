import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../../../contexts/ThemeContext';

interface SettingRowProps {
  label: string;
  description?: string;
  children?: React.ReactNode;
}

export function SettingRow({ label, description, children }: SettingRowProps) {
  const { theme } = useTheme();
  return (
    <View style={styles.row}>
      <View style={styles.labelGroup}>
        <Text style={[styles.label, { color: theme.colors.text }]}>{label}</Text>
        {description ? (
          <Text style={[styles.description, { color: theme.colors.textMuted }]}>{description}</Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 52,
    gap: 16,
  },
  labelGroup: {
    flex: 1,
  },
  label: {
    fontSize: 16,
  },
  description: {
    fontSize: 13,
    marginTop: 2,
  },
});
