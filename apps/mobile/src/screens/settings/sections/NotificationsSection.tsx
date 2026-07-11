import React from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { createModuleLogger } from '../../../logger';
import { useTheme } from '../../../contexts/ThemeContext';
import { Icon } from '../../../components/Icon';
import { Section } from '../components';

const logger = createModuleLogger('NotificationsSection');

const notificationRows = [
  {
    key: 'taskforceai',
    titleKey: 'mobile.settings.notificationCategories.taskforceai',
    defaultTitle: 'TaskForceAI',
  },
  {
    key: 'responses',
    titleKey: 'mobile.settings.notificationCategories.responses',
    defaultTitle: 'Responses',
  },
  {
    key: 'tasks',
    titleKey: 'mobile.settings.notificationCategories.tasks',
    defaultTitle: 'Tasks',
  },
  {
    key: 'projects',
    titleKey: 'mobile.settings.notificationCategories.projects',
    defaultTitle: 'Projects',
  },
  {
    key: 'usage',
    titleKey: 'mobile.settings.notificationCategories.usage',
    defaultTitle: 'Usage',
  },
] as const;

interface NotificationsSectionProps {
  notificationsEnabled: boolean;
  updatingNotifications: boolean;
  onNotificationsToggle: (value: boolean) => Promise<void>;
}

export function NotificationsSection({
  notificationsEnabled,
  updatingNotifications,
  onNotificationsToggle,
}: NotificationsSectionProps) {
  const { theme } = useTheme();
  const { t } = useTranslation();

  const handleToggle = async (value: boolean) => {
    try {
      await onNotificationsToggle(value);
    } catch (error) {
      logger.error('Notifications toggle failed', { error });
      Alert.alert(
        t('mobile.settings.notificationsErrorTitle'),
        t('mobile.settings.notificationsErrorMessage')
      );
    }
  };

  const deliveryLabel = notificationsEnabled
    ? t('mobile.settings.notificationDelivery.push', { defaultValue: 'Push' })
    : t('mobile.settings.notificationDelivery.off', { defaultValue: 'Off' });

  return (
    <Section>
      {notificationRows.map((row) => {
        const title = t(row.titleKey, { defaultValue: row.defaultTitle });
        return (
          <TouchableOpacity
            key={row.key}
            activeOpacity={0.65}
            disabled={updatingNotifications}
            accessibilityRole="button"
            accessibilityLabel={t('mobile.settings.notificationDeliveryRowLabel', {
              title,
              delivery: deliveryLabel,
              defaultValue: `${title} notifications: ${deliveryLabel}`,
            })}
            accessibilityState={{ disabled: updatingNotifications }}
            onPress={() => void handleToggle(!notificationsEnabled)}
            style={styles.deliveryRow}
          >
            <Text style={[styles.rowLabel, { color: theme.colors.text }]}>{title}</Text>
            <View style={styles.deliveryValueGroup}>
              <Text style={[styles.deliveryValue, { color: theme.colors.textMuted }]}>
                {deliveryLabel}
              </Text>
              <Icon name="ChevronRight" size={16} color={theme.colors.textMuted} />
            </View>
          </TouchableOpacity>
        );
      })}
    </Section>
  );
}

const styles = StyleSheet.create({
  deliveryRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 11,
    gap: 16,
  },
  rowLabel: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
  },
  deliveryValueGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  deliveryValue: {
    fontSize: 15,
    lineHeight: 20,
  },
});
