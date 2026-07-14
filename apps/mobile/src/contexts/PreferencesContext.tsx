import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { createModuleLogger } from '../logger';

const AUTO_SYNC_KEY = '@taskforceai:autoSyncEnabled';
const NOTIFICATIONS_KEY = '@taskforceai:notificationsEnabled';
const logger = createModuleLogger('PreferencesContext');

interface PreferencesContextValue {
  autoSyncEnabled: boolean;
  setAutoSyncEnabled: (value: boolean) => Promise<void>;
  notificationsEnabled: boolean;
  setNotificationsEnabled: (value: boolean) => Promise<void>;
  hasLoadedPreferences: boolean;
}

const PreferencesContext = createContext<PreferencesContextValue | undefined>(undefined);

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [autoSyncEnabled, setAutoSyncEnabledState] = useState(true);
  const [notificationsEnabled, setNotificationsEnabledState] = useState(true);
  const [hasLoadedPreferences, setHasLoadedPreferences] = useState(false);

  useEffect(() => {
    let mounted = true;
    const loadPreferences = async () => {
      try {
        const [storedAutoSync, storedNotifications] = await Promise.all([
          AsyncStorage.getItem(AUTO_SYNC_KEY),
          AsyncStorage.getItem(NOTIFICATIONS_KEY),
        ]);
        if (mounted && storedAutoSync !== null) {
          setAutoSyncEnabledState(storedAutoSync === 'true');
        }
        if (mounted && storedNotifications !== null) {
          setNotificationsEnabledState(storedNotifications === 'true');
        }
      } catch (error) {
        logger.warn('Failed to load preferences', { error });
        // Don't re-throw in useEffect
      } finally {
        if (mounted) {
          setHasLoadedPreferences(true);
        }
      }
    };

    void loadPreferences();
    return () => {
      mounted = false;
    };
  }, []);

  const setAutoSyncEnabled = useCallback(async (enabled: boolean) => {
    const previousAutoSyncEnabled = autoSyncEnabled;
    setAutoSyncEnabledState(enabled);
    try {
      await AsyncStorage.setItem(AUTO_SYNC_KEY, JSON.stringify(enabled));
    } catch (error) {
      setAutoSyncEnabledState(previousAutoSyncEnabled);
      logger.warn('Failed to persist auto-sync preference', { error, enabled });
      throw error;
    }
  }, [autoSyncEnabled]);

  const setNotificationsEnabled = useCallback(async (enabled: boolean) => {
    const previousNotificationsEnabled = notificationsEnabled;
    setNotificationsEnabledState(enabled);
    try {
      await AsyncStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(enabled));
    } catch (error) {
      setNotificationsEnabledState(previousNotificationsEnabled);
      logger.warn('Failed to persist notifications preference', { error, enabled });
      throw error;
    }
  }, [notificationsEnabled]);

  const value = useMemo(
    () => ({
      autoSyncEnabled,
      setAutoSyncEnabled,
      notificationsEnabled,
      setNotificationsEnabled,
      hasLoadedPreferences,
    }),
    [autoSyncEnabled, setAutoSyncEnabled, notificationsEnabled, setNotificationsEnabled, hasLoadedPreferences]
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const context = useContext(PreferencesContext);
  if (!context) {
    throw new Error('usePreferences must be used within PreferencesProvider');
  }
  return context;
}
