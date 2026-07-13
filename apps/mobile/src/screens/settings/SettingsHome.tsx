import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { EdgeInsets } from 'react-native-safe-area-context';
import type { TFunction } from 'i18next';

import { Icon } from '../../components/Icon';
import type { Theme } from '../../theme/theme';
import { settingsItems } from './config';
import type { SettingsSectionId } from './types';

interface SettingsHomeProps {
  insets: EdgeInsets;
  theme: Theme;
  t: TFunction;
  profileInitials: string;
  profileName: string;
  profileHandle: string;
  planLabel?: string;
  isAuthenticated?: boolean;
  onSelectSection: (section: SettingsSectionId) => void;
}

export function SettingsHome({
  insets,
  theme,
  t,
  profileInitials,
  profileName,
  profileHandle,
  planLabel,
  isAuthenticated = false,
  onSelectSection,
}: SettingsHomeProps) {
  const visibleItems = React.useMemo(
    () =>
      isAuthenticated
        ? settingsItems
        : settingsItems.filter((item) => item.id === 'general' || item.id === 'storage' || item.id === 'data'),
    [isAuthenticated]
  );

  return (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: Math.max(insets.bottom, 32) }}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.profile}>
        <View style={[styles.avatar, { backgroundColor: theme.colors.userBubble }]}>
          <Text style={styles.avatarText}>{profileInitials}</Text>
        </View>
        <Text style={[styles.profileName, { color: theme.colors.text }]} numberOfLines={1}>
          {profileName}
        </Text>
        <Text style={[styles.profileHandle, { color: theme.colors.textMuted }]} numberOfLines={1}>
          {profileHandle}
        </Text>
        <TouchableOpacity
          onPress={() => onSelectSection('general')}
          style={[styles.editProfileBtn, { borderColor: theme.colors.border }]}
          accessibilityRole="button"
        >
          <Text style={[styles.editProfileText, { color: theme.colors.text }]}>
            {t('mobile.settings.editProfile', { defaultValue: 'Edit profile' })}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.card, { backgroundColor: theme.colors.cardBackground }]}>
        {visibleItems.map((item, index) => {
          const isLast = index === visibleItems.length - 1;
          const rightValue = item.id === 'subscription' ? planLabel : undefined;
          return (
            <TouchableOpacity
              key={item.id}
              onPress={() => onSelectSection(item.id)}
              style={[
                styles.row,
                !isLast && {
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: theme.colors.border,
                },
              ]}
              accessibilityRole="button"
            >
              <Icon name={item.iconName} size={20} color={theme.colors.text} strokeWidth={1.5} />
              <Text style={[styles.rowLabel, { color: theme.colors.text }]}>
                {t(item.i18nKey, { defaultValue: item.defaultLabel })}
              </Text>
              {rightValue ? (
                <Text style={[styles.rowValue, { color: theme.colors.textMuted }]}>
                  {rightValue}
                </Text>
              ) : null}
              <Icon name="ChevronRight" size={18} color={theme.colors.textMuted} strokeWidth={1.5} />
            </TouchableOpacity>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  profile: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 32,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarText: {
    fontSize: 28,
    fontWeight: '700',
    color: '#fff',
  },
  profileName: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 4,
  },
  profileHandle: {
    fontSize: 14,
    marginBottom: 16,
  },
  editProfileBtn: {
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  editProfileText: {
    fontSize: 14,
    fontWeight: '500',
  },
  card: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingHorizontal: 16,
    gap: 12,
  },
  rowLabel: {
    flex: 1,
    fontSize: 16,
  },
  rowValue: {
    fontSize: 15,
  },
});
