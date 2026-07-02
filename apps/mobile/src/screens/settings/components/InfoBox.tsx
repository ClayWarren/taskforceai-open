import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../../../contexts/ThemeContext';

interface InfoBoxProps {
  label: string;
  children: React.ReactNode;
}

export function InfoBox({ label, children }: InfoBoxProps) {
  const { theme } = useTheme();
  return (
    <View style={styles.row}>
      <Text style={[styles.label, { color: theme.colors.textMuted }]}>{label}</Text>
      <Text style={[styles.value, { color: theme.colors.text }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  label: {
    fontSize: 12,
    marginBottom: 3,
  },
  value: {
    fontSize: 15,
  },
});
