import { spacingTokens } from '@taskforceai/design-tokens';
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { Icon, type IconName } from './Icon';

export interface ModeBadge {
  id: string;
  label: string;
  iconName: IconName;
  enabled: boolean;
  onPress?: () => void;
  onDismiss?: () => void;
}

interface ModeBadgesProps {
  badges: ModeBadge[];
}

export function ModeBadges({ badges }: ModeBadgesProps) {
  const activeBadges = badges.filter((b) => b.enabled);

  if (activeBadges.length === 0) return null;

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {activeBadges.map((badge) => (
          <View key={badge.id} style={styles.badge}>
            {badge.onPress ? (
              <TouchableOpacity
                style={styles.badgeContent}
                onPress={badge.onPress}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={badge.label}
              >
                <Icon name={badge.iconName} size={12} color="#ffffff" />
                <Text style={styles.badgeText}>{badge.label}</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.badgeContent}>
                <Icon name={badge.iconName} size={12} color="#ffffff" />
                <Text style={styles.badgeText}>{badge.label}</Text>
              </View>
            )}
            {badge.onDismiss && (
              <TouchableOpacity
                onPress={badge.onDismiss}
                hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                accessibilityRole="button"
                accessibilityLabel={`Disable ${badge.label}`}
              >
                <Icon name="X" size={12} color="rgba(255,255,255,0.7)" />
              </TouchableOpacity>
            )}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacingTokens.xs,
  },
  scrollContent: {
    paddingHorizontal: spacingTokens.md,
    gap: spacingTokens.xs,
    flexDirection: 'row',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingTokens.xs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: spacingTokens.sm,
    paddingVertical: spacingTokens.xs / 2,
  },
  badgeContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingTokens.xs,
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '500',
  },
});
