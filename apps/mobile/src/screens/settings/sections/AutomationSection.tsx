import React from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { DesktopSessions } from '../../../components/DesktopSessions';
import { Section } from '../components';

export function AutomationSection() {
  const { t } = useTranslation();

  return (
    <Section
      title={t('mobile.settings.tabs.automation', { defaultValue: 'Automation' })}
      variant="plain"
    >
      <View className="rounded-2xl border border-white/10 bg-white/5 px-md py-md">
        <Text className="text-text text-sm font-semibold">
          {t('mobile.settings.automationTitle', { defaultValue: 'Agent activity' })}
        </Text>
        <Text className="text-text-muted mt-1 text-xs">
          {t('mobile.settings.automationDescription', {
            defaultValue:
              'Review active desktop sessions and approve sensitive automation actions from your phone.',
          })}
        </Text>
      </View>
      <DesktopSessions showEmpty inset={false} title="Active sessions" />
    </Section>
  );
}
