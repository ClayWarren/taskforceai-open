import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../../../contexts/ThemeContext';

interface InfoRowProps {
  label: string;
  value: string;
}

export function InfoRow({ label, value }: InfoRowProps) {
  const { theme } = useTheme();
  return (
    <View style={styles.row}>
      <Text style={[styles.label, { color: theme.colors.text }]}>{label}</Text>
      <Text style={[styles.value, { color: theme.colors.textMuted }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 13,
    minHeight: 52,
    gap: 12,
  },
  label: {
    fontSize: 16,
  },
  value: {
    fontSize: 15,
    flexShrink: 1,
  },
});
