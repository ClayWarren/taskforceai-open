'use client';

import { useCallback } from 'react';

import { updateUserSettings } from '@taskforceai/contracts/api/account';
import type { ThemePreference } from '@taskforceai/shared/preferences/theme-storage';

import { logger } from '../logger';
import { updateDesktopAppServerLocalSettings } from '../platform/desktop/app-server';
import type { AppServerLocalSettingsUpdate } from '../platform/desktop/app-server-types';
import { usePlatformRuntime } from '../platform/PlatformProvider';
import { useAuth } from '../providers/AuthProvider';

interface UseProfilePreferenceActionsOptions {
  setFeedbackKind: (_kind: 'success' | 'error') => void;
  setFeedbackMessage: (_message: string | null) => void;
}

export function useProfilePreferenceActions({
  setFeedbackKind,
  setFeedbackMessage,
}: UseProfilePreferenceActionsOptions) {
  const platformRuntime = usePlatformRuntime();
  const { refreshUser } = useAuth();

  const updateDesktopProfileSetting = useCallback(
    async (settings: AppServerLocalSettingsUpdate, failureMessage: string, logMessage: string) => {
      try {
        await updateDesktopAppServerLocalSettings(settings);
        setFeedbackKind('success');
        setFeedbackMessage('Preference updated.');
      } catch (error) {
        logger.error(logMessage, { error, settings });
        setFeedbackKind('error');
        setFeedbackMessage(failureMessage);
      }
    },
    [setFeedbackKind, setFeedbackMessage]
  );

  const updateProfileSetting = useCallback(
    async (
      settings: Parameters<typeof updateUserSettings>[0],
      failureMessage: string,
      logMessage: string
    ) => {
      try {
        const result = await updateUserSettings(settings);
        if (!result.ok) {
          throw result.error;
        }
        setFeedbackKind('success');
        setFeedbackMessage('Preference updated.');
        void refreshUser({ force: true });
      } catch (error) {
        logger.error(logMessage, { error, settings });
        setFeedbackKind('error');
        setFeedbackMessage(failureMessage);
      }
    },
    [refreshUser, setFeedbackKind, setFeedbackMessage]
  );

  const updatePreferenceSetting = useCallback(
    async (
      webSettings: Parameters<typeof updateUserSettings>[0],
      desktopSettings: AppServerLocalSettingsUpdate,
      failureMessage: string,
      logMessage: string
    ) => {
      if (platformRuntime === 'desktop') {
        await updateDesktopProfileSetting(desktopSettings, failureMessage, logMessage);
        return;
      }
      await updateProfileSetting(webSettings, failureMessage, logMessage);
    },
    [platformRuntime, updateDesktopProfileSetting, updateProfileSetting]
  );

  return {
    handleMemoryToggle: (enabled: boolean) =>
      updatePreferenceSetting(
        { memory_enabled: enabled },
        { memoryEnabled: enabled },
        'Failed to update memory setting.',
        'Failed to toggle memory setting'
      ),
    handleWebSearchToggle: (enabled: boolean) =>
      updatePreferenceSetting(
        { web_search_enabled: enabled },
        { webSearchEnabled: enabled },
        'Failed to update web search setting.',
        'Failed to toggle web search setting'
      ),
    handleCodeExecutionToggle: (enabled: boolean) =>
      updatePreferenceSetting(
        { code_execution_enabled: enabled },
        { codeExecutionEnabled: enabled },
        'Failed to update code execution setting.',
        'Failed to toggle code execution setting'
      ),
    handleTrustLayerToggle: (enabled: boolean) =>
      updatePreferenceSetting(
        { trust_layer_enabled: enabled },
        { trustLayerEnabled: enabled },
        'Failed to update trust layer setting.',
        'Failed to toggle trust layer setting'
      ),
    handleNotificationsToggle: (enabled: boolean) =>
      updatePreferenceSetting(
        { notifications_enabled: enabled },
        { notificationsEnabled: enabled },
        'Failed to update notifications setting.',
        'Failed to toggle notifications setting'
      ),
    handleThemeChange: (theme: ThemePreference) =>
      updatePreferenceSetting(
        { theme_preference: theme },
        { theme },
        'Failed to update theme preference.',
        'Failed to update theme setting'
      ),
  };
}
