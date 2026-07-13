import type { AuthenticatedUser } from '@taskforceai/contracts/contracts';
import {
  inferDisplayNameFromEmail,
  normalizeProfileFullName,
} from '@taskforceai/presenters/profile/view-model';
import React from 'react';
import { Alert } from 'react-native';

import { updateMobileSettings } from '../../api/settings';
import { createModuleLogger } from '../../logger';
import { ensurePushRegistration, unregisterPushNotifications } from '../../notifications/registration';
import { sqliteStorage } from '../../storage/sqlite-adapter';
import type { PersonalizationKey, PersonalizationState, RemoteSettingsPatch } from './types';

const logger = createModuleLogger('SettingsPreferenceActions');

interface UseSettingsPreferenceActionsOptions {
  isDarkMode: boolean;
  notificationsEnabled: boolean;
  refreshUser: (options?: { force?: boolean }) => Promise<void>;
  setNotificationsEnabled: (enabled: boolean) => Promise<void>;
  setThemeMode: (mode: 'dark' | 'light') => Promise<void>;
  t: (key: string, options?: { defaultValue?: string }) => string;
  user: AuthenticatedUser | null | undefined;
}

export function useSettingsPreferenceActions({
  isDarkMode,
  notificationsEnabled,
  refreshUser,
  setNotificationsEnabled,
  setThemeMode,
  t,
  user,
}: UseSettingsPreferenceActionsOptions) {
  const [updatingTheme, setUpdatingTheme] = React.useState(false);
  const [updatingNotifications, setUpdatingNotifications] = React.useState(false);
  const [updatingFullName, setUpdatingFullName] = React.useState(false);
  const [updatingPersonalization, setUpdatingPersonalization] =
    React.useState<PersonalizationKey | null>(null);
  const [personalization, setPersonalization] = React.useState<PersonalizationState>({
    memoryEnabled: user?.memory_enabled ?? true,
    webSearchEnabled: user?.web_search_enabled ?? true,
    codeExecutionEnabled: user?.code_execution_enabled ?? true,
    trustLayerEnabled: user?.trust_layer_enabled ?? false,
  });
  const [editableFullName, setEditableFullName] = React.useState(
    normalizeProfileFullName(user?.full_name) || inferDisplayNameFromEmail(user?.email)
  );

  React.useEffect(() => {
    if (!user) return;
    setPersonalization({
      memoryEnabled: user.memory_enabled,
      webSearchEnabled: user.web_search_enabled,
      codeExecutionEnabled: user.code_execution_enabled,
      trustLayerEnabled: user.trust_layer_enabled,
    });
  }, [user]);

  React.useEffect(() => {
    setEditableFullName(normalizeProfileFullName(user?.full_name) || inferDisplayNameFromEmail(user?.email));
  }, [user?.full_name, user?.email]);

  const persistRemoteSettings = React.useCallback(
    async (patch: RemoteSettingsPatch) => {
      const result = await updateMobileSettings(patch);
      if (!result.ok) throw result.error;
    },
    []
  );

  const updateRemoteSettings = React.useCallback(
    async (patch: RemoteSettingsPatch) => {
      await persistRemoteSettings(patch);
      await refreshUser({ force: true });
    },
    [persistRemoteSettings, refreshUser]
  );

  const handleThemeToggle = async () => {
    if (updatingTheme) return;
    const nextTheme = isDarkMode ? 'light' : 'dark';
    setUpdatingTheme(true);
    try {
      await setThemeMode(nextTheme);
      await updateRemoteSettings({ theme_preference: nextTheme });
    } catch (error) {
      logger.error('Theme update failed', { error, nextTheme });
      Alert.alert(
        t('mobile.settings.themeErrorTitle', { defaultValue: 'Theme update failed' }),
        t('mobile.settings.themeErrorMessage', {
          defaultValue: 'We could not update your theme preference. Please try again.',
        })
      );
    } finally {
      setUpdatingTheme(false);
    }
  };

  const handleNotificationsToggle = async (value: boolean) => {
    if (updatingNotifications) return;
    setUpdatingNotifications(true);
    let remoteChanged = false;
    let registeredForPush = false;
    let permissionDenied = false;
    try {
      if (value) {
        const { status } = await ensurePushRegistration({ promptUser: true });
        if (status !== 'granted') {
          permissionDenied = true;
          Alert.alert(
            t('mobile.settings.notificationsPermissionDeniedTitle'),
            t('mobile.settings.notificationsPermissionDeniedMessage')
          );
          await setNotificationsEnabled(false);
          await persistRemoteSettings({ notifications_enabled: false });
          await refreshUser({ force: true });
          return;
        }
        registeredForPush = true;
        await persistRemoteSettings({ notifications_enabled: true });
        remoteChanged = true;
        await setNotificationsEnabled(true);
      } else {
        await persistRemoteSettings({ notifications_enabled: false });
        remoteChanged = true;
        await setNotificationsEnabled(false);
        await unregisterPushNotifications();
      }
      await refreshUser({ force: true });
    } catch (error) {
      if (!permissionDenied) {
        const rollbackTasks: Promise<unknown>[] = [setNotificationsEnabled(notificationsEnabled)];
        if (remoteChanged) {
          rollbackTasks.push(
            persistRemoteSettings({ notifications_enabled: notificationsEnabled })
          );
        }
        if (value && registeredForPush && !notificationsEnabled) {
          rollbackTasks.push(unregisterPushNotifications());
        } else if (!value && notificationsEnabled) {
          rollbackTasks.push(ensurePushRegistration({ promptUser: false }));
        }
        const rollbackResults = await Promise.allSettled(rollbackTasks);
        if (rollbackResults.some((result) => result.status === 'rejected')) {
          logger.error('Failed to fully roll back notifications preference');
        }
      }
      logger.error('Failed to toggle notifications preference', { error });
      Alert.alert(
        t('mobile.settings.notificationsErrorTitle'),
        t('mobile.settings.notificationsErrorMessage')
      );
    } finally {
      setUpdatingNotifications(false);
    }
  };

  const handlePersonalizationToggle = async (key: PersonalizationKey, value: boolean) => {
    if (updatingPersonalization !== null) return;
    const previousValue = personalization[key];
    setPersonalization((previous) => ({ ...previous, [key]: value }));
    setUpdatingPersonalization(key);
    try {
      if (key === 'memoryEnabled') await updateRemoteSettings({ memory_enabled: value });
      else if (key === 'webSearchEnabled') await updateRemoteSettings({ web_search_enabled: value });
      else if (key === 'codeExecutionEnabled') await updateRemoteSettings({ code_execution_enabled: value });
      else if (key === 'trustLayerEnabled') await updateRemoteSettings({ trust_layer_enabled: value });
    } catch (error) {
      setPersonalization((previous) => ({ ...previous, [key]: previousValue }));
      logger.error('Failed to update personalization setting', { error, key, value });
      Alert.alert(
        t('mobile.settings.personalizationErrorTitle', { defaultValue: 'Update failed' }),
        t('mobile.settings.personalizationErrorMessage', {
          defaultValue: 'We could not save this setting. Please try again.',
        })
      );
    } finally {
      setUpdatingPersonalization(null);
    }
  };

  const handleSaveFullName = async () => {
    if (updatingFullName) return;
    const nextName = editableFullName.trim();
    if (nextName.length === 0) {
      Alert.alert(
        t('mobile.settings.fullNameRequiredTitle', { defaultValue: 'Name required' }),
        t('mobile.settings.fullNameRequiredMessage', {
          defaultValue: 'Please enter your full name before saving.',
        })
      );
      return;
    }
    if (nextName === (user?.full_name?.trim() ?? '')) {
      return;
    }
    setUpdatingFullName(true);
    try {
      const result = await updateMobileSettings({ full_name: nextName });
      if (!result.ok) throw result.error;

      if (user) {
        const saveProfileResult = await sqliteStorage.saveProfile({
          ...user,
          full_name: nextName,
        });
        if (!saveProfileResult.ok) {
          logger.warn('Failed to persist updated full name locally', {
            error: saveProfileResult.error,
          });
        }
      }

      await refreshUser({ force: true });
    } catch (error) {
      logger.error('Failed to update full name', { error, nextName });
      Alert.alert(
        t('mobile.settings.fullNameErrorTitle', { defaultValue: 'Unable to save name' }),
        t('mobile.settings.fullNameErrorMessage', {
          defaultValue: 'Please try again in a moment.',
        })
      );
    } finally {
      setUpdatingFullName(false);
    }
  };

  return {
    editableFullName,
    handleNotificationsToggle,
    handlePersonalizationToggle,
    handleSaveFullName,
    handleThemeToggle,
    personalization,
    setEditableFullName,
    updatingFullName,
    updatingNotifications,
    updatingPersonalization,
    updatingTheme,
  };
}
