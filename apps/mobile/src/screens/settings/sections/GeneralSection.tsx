import Constants from 'expo-constants';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { ActionButton } from '../../../components/ActionButton';
import { usePreferences } from '../../../contexts/PreferencesContext';
import { useTheme } from '../../../contexts/ThemeContext';
import { Section, SettingRow, InfoRow } from '../components';

interface GeneralSectionProps {
  profileEmail: string;
  editableName: string;
  isAuthenticated?: boolean;
  isSavingName: boolean;
  onEditableNameChange: (value: string) => void;
  onSaveName: () => Promise<void>;
}

export function GeneralSection({
  profileEmail,
  editableName,
  isAuthenticated = false,
  isSavingName,
  onEditableNameChange,
  onSaveName,
}: GeneralSectionProps) {
  const { theme } = useTheme();
  const { t } = useTranslation();

  return (
    <Section title={t('mobile.settings.accountSection', { defaultValue: 'Account' })}>
      {isAuthenticated ? (
        <>
          <InfoRow
            label={t('mobile.profile.email', { defaultValue: 'Email' })}
            value={profileEmail}
          />
          <View style={styles.nameEditor}>
            <Text style={[styles.nameLabel, { color: theme.colors.text }]}>
              {t('mobile.profile.fullName', { defaultValue: 'Full Name' })}
            </Text>
            <TextInput
              value={editableName}
              onChangeText={onEditableNameChange}
              style={[
                styles.nameInput,
                {
                  borderColor: theme.colors.border,
                  color: theme.colors.text,
                  backgroundColor: theme.colors.background,
                },
              ]}
              placeholder={t('mobile.settings.fullNamePlaceholder', { defaultValue: 'Enter your full name' })}
              placeholderTextColor={theme.colors.textMuted}
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="done"
            />
            <ActionButton
              size="large"
              className="mb-0"
              disabled={isSavingName || editableName.trim().length === 0}
              isLoading={isSavingName}
              onPress={() => {
                void onSaveName();
              }}
            >
              {t('mobile.settings.saveName', { defaultValue: 'Save name' })}
            </ActionButton>
          </View>
        </>
      ) : (
        <InfoRow
          label={t('mobile.settings.guestMode', { defaultValue: 'Guest mode' })}
          value={t('mobile.settings.guestModeDescription', {
            defaultValue: 'Local settings and legal/support links are available without an account.',
          })}
        />
      )}
    </Section>
  );
}

interface AppearanceSectionProps {
  isDarkMode: boolean;
  updatingTheme: boolean;
  onThemeToggle: () => Promise<void>;
}

export function AppearanceSection({
  isDarkMode,
  updatingTheme,
  onThemeToggle,
}: AppearanceSectionProps) {
  const { theme } = useTheme();
  const {
    remoteTextScale,
    setRemoteTextScale,
    remoteCodeScale,
    setRemoteCodeScale,
    remoteWordWrap,
    setRemoteWordWrap,
  } = usePreferences();
  const { t } = useTranslation();
  const appVersion = Constants.expoConfig?.version ?? 'dev';

  return (
    <Section title={t('mobile.settings.appearance', { defaultValue: 'Appearance' })}>
      <SettingRow
        label={t('mobile.settings.darkMode')}
        description={t('mobile.settings.darkModeDescription')}
      >
        <Switch
          value={isDarkMode}
          onValueChange={() => {
            void onThemeToggle();
          }}
          trackColor={{ false: '#767577', true: theme.colors.primary }}
          thumbColor={isDarkMode ? theme.colors.white : '#f4f3f4'}
          disabled={updatingTheme}
          accessibilityLabel={t('mobile.settings.darkMode')}
          accessibilityRole="switch"
          accessibilityHint={t('mobile.settings.darkModeDescription')}
        />
      </SettingRow>
      <SettingRow label="Remote text size" description={`${Math.round(remoteTextScale * 100)}%`}>
        <ScaleControl value={remoteTextScale} onChange={setRemoteTextScale} label="Remote text size" />
      </SettingRow>
      <SettingRow label="Code and diff size" description={`${Math.round(remoteCodeScale * 100)}%`}>
        <ScaleControl value={remoteCodeScale} onChange={setRemoteCodeScale} label="Code and diff size" />
      </SettingRow>
      <SettingRow label="Wrap Remote code" description="Wrap long lines in files and diffs">
        <Switch
          value={remoteWordWrap}
          onValueChange={(value) => void setRemoteWordWrap(value)}
          trackColor={{ false: '#767577', true: theme.colors.primary }}
          accessibilityLabel="Wrap Remote code"
        />
      </SettingRow>
      <InfoRow
        label={t('mobile.settings.version', { defaultValue: 'Version' })}
        value={appVersion}
      />
    </Section>
  );
}

function ScaleControl({ value, onChange, label }: { value: number; onChange: (value: number) => Promise<void>; label: string }) {
  const { theme } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Decrease ${label}`} onPress={() => void onChange(value - 0.1)} style={[styles.scaleButton, { borderColor: theme.colors.border }]}>
        <Text style={{ color: theme.colors.text, fontSize: 18 }}>−</Text>
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Increase ${label}`} onPress={() => void onChange(value + 0.1)} style={[styles.scaleButton, { borderColor: theme.colors.border }]}>
        <Text style={{ color: theme.colors.text, fontSize: 18 }}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  scaleButton: { width: 34, height: 34, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  nameEditor: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  nameLabel: {
    fontSize: 16,
  },
  nameInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
});
