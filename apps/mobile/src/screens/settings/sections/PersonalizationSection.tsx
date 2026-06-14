import React from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';

import { Icon } from '../../../components/Icon';
import { createModuleLogger } from '../../../logger';
import { useTheme } from '../../../contexts/ThemeContext';
import { MemorySummaryModal } from '../MemorySummaryModal';
import { Section, SettingRow } from '../components';
import type { SettingsMemoriesState } from '../useSettingsMemories';

const logger = createModuleLogger('PersonalizationSection');

interface PersonalizationState {
  memoryEnabled: boolean;
  webSearchEnabled: boolean;
  codeExecutionEnabled: boolean;
  trustLayerEnabled: boolean;
}

type PersonalizationKey = keyof PersonalizationState;

interface PersonalizationItem {
  key: PersonalizationKey;
  titleKey: string;
  title: string;
  descriptionKey: string;
  description: string;
}

const CAPABILITY_ITEMS: PersonalizationItem[] = [
  {
    key: 'webSearchEnabled',
    titleKey: 'mobile.settings.webSearchTitle',
    title: 'Web Search',
    descriptionKey: 'mobile.settings.webSearchDescription',
    description: 'Allow live web lookups for real-time information.',
  },
  {
    key: 'codeExecutionEnabled',
    titleKey: 'mobile.settings.codeExecutionTitle',
    title: 'Code Execution',
    descriptionKey: 'mobile.settings.codeExecutionDescription',
    description: 'Allow the AI to run code for advanced tasks.',
  },
  {
    key: 'trustLayerEnabled',
    titleKey: 'mobile.settings.trustLayerTitle',
    title: 'Trust Layer',
    descriptionKey: 'mobile.settings.trustLayerDescription',
    description: 'Enable extra safety checks and execution reporting.',
  },
];

interface PersonalizationSectionProps {
  personalization: PersonalizationState;
  updatingKey: PersonalizationKey | null;
  onToggle: (key: PersonalizationKey, value: boolean) => Promise<void>;
  memorySummary: SettingsMemoriesState;
}

export function PersonalizationSection({
  personalization,
  updatingKey,
  onToggle,
  memorySummary,
}: PersonalizationSectionProps) {
  const { theme } = useTheme();
  const { t } = useTranslation();

  const handleToggle = async (key: PersonalizationKey, value: boolean) => {
    try {
      await onToggle(key, value);
    } catch (error) {
      logger.error('Personalization toggle failed', { key, error });
    }
  };

  return (
    <>
      <Section title={t('mobile.settings.memoryTitle', { defaultValue: 'Memory' })}>
        <SettingRow
          label={t('mobile.settings.memoryEnableTitle', { defaultValue: 'Enable memory' })}
          description={t('mobile.settings.memoryDescription', {
            defaultValue: 'AI remembers useful context across chats.',
          })}
        >
          <Switch
            value={personalization.memoryEnabled}
            onValueChange={(value) => handleToggle('memoryEnabled', value)}
            trackColor={{ false: '#767577', true: theme.colors.primary }}
            thumbColor={personalization.memoryEnabled ? theme.colors.white : '#f4f3f4'}
            disabled={updatingKey !== null}
            accessibilityLabel={t('mobile.settings.memoryEnableTitle', { defaultValue: 'Enable memory' })}
          />
        </SettingRow>

        <TouchableOpacity
          onPress={memorySummary.open}
          style={styles.summaryRow}
          accessibilityRole="button"
          accessibilityLabel={t('mobile.settings.memorySummaryTitle', { defaultValue: 'Memory summary' })}
        >
          <View style={styles.summaryText}>
            <Text style={[styles.summaryLabel, { color: theme.colors.text }]}>
              {t('mobile.settings.memorySummaryTitle', { defaultValue: 'Memory summary' })}
            </Text>
            <Text style={[styles.summaryDescription, { color: theme.colors.textMuted }]}>
              {t('mobile.settings.memorySummaryDescription', {
                defaultValue: 'View and manage what TaskForceAI remembers about you.',
              })}
            </Text>
          </View>
          <Icon name="ChevronRight" size={18} color={theme.colors.textMuted} />
        </TouchableOpacity>
      </Section>

      <Section title={t('mobile.settings.personalizationTitle', { defaultValue: 'Preferences' })}>
        {CAPABILITY_ITEMS.map((item) => {
          const enabled = personalization[item.key];
          return (
            <SettingRow
              key={item.key}
              label={t(item.titleKey, { defaultValue: item.title })}
              description={t(item.descriptionKey, { defaultValue: item.description })}
            >
              <Switch
                value={enabled}
                onValueChange={(value) => handleToggle(item.key, value)}
                trackColor={{ false: '#767577', true: theme.colors.primary }}
                thumbColor={enabled ? theme.colors.white : '#f4f3f4'}
                disabled={updatingKey !== null}
              />
            </SettingRow>
          );
        })}
      </Section>

      <MemorySummaryModal
        visible={memorySummary.visible}
        memories={memorySummary.memories}
        loading={memorySummary.loading}
        saving={memorySummary.saving}
        deletingId={memorySummary.deletingId}
        editingMemoryId={memorySummary.editingMemoryId}
        draft={memorySummary.draft}
        error={memorySummary.error}
        onClose={memorySummary.close}
        onRetry={memorySummary.retry}
        onDraftChange={memorySummary.setDraft}
        onSubmit={memorySummary.submit}
        onEdit={memorySummary.edit}
        onDelete={memorySummary.delete}
        onCancelEdit={memorySummary.cancelEdit}
      />
    </>
  );
}

const styles = StyleSheet.create({
  summaryRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  summaryText: {
    flex: 1,
  },
  summaryLabel: {
    fontSize: 16,
  },
  summaryDescription: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
});
