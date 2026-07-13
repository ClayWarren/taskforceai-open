import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../../../contexts/ThemeContext';

interface SectionProps {
  title?: string;
  variant?: 'card' | 'plain';
  children: React.ReactNode;
}

export function Section({ title, variant = 'card', children }: SectionProps) {
  const { theme } = useTheme();
  const childArray = React.Children.toArray(children).filter(Boolean);
  const isPlain = variant === 'plain';

  return (
    <View style={styles.wrapper}>
      {title ? (
        <Text style={[styles.title, { color: theme.colors.textMuted }]}>{title}</Text>
      ) : null}
      {isPlain ? (
        <View style={styles.plainContainer}>{childArray}</View>
      ) : (
        <View style={[styles.card, { backgroundColor: theme.colors.cardBackground }]}>
          {childArray.map((child, index) => (
            <React.Fragment key={index}>
              {index > 0 && (
                <View style={[styles.divider, { backgroundColor: theme.colors.border, marginLeft: 16 }]} />
              )}
              {child}
            </React.Fragment>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: 24,
  },
  title: {
    fontSize: 13,
    fontWeight: '400',
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  plainContainer: {
    gap: 12,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
});
