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
          <TouchableOpacity
            key={badge.id}
            style={styles.badge}
            onPress={badge.onPress}
            activeOpacity={badge.onPress ? 0.7 : 1}
            disabled={!badge.onPress}
            accessibilityRole={badge.onPress ? 'button' : undefined}
            accessibilityLabel={badge.label}
          >
            <Icon name={badge.iconName} size={12} color="#ffffff" />
            <Text style={styles.badgeText}>{badge.label}</Text>
            {badge.onDismiss && (
              <TouchableOpacity
                onPress={badge.onDismiss}
                hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                accessibilityLabel={`Disable ${badge.label}`}
              >
                <Icon name="X" size={12} color="rgba(255,255,255,0.7)" />
              </TouchableOpacity>
            )}
          </TouchableOpacity>
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
  badgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '500',
  },
});
