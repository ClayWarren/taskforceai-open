import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { createModuleLogger } from '../logger';

const AUTO_SYNC_KEY = '@taskforceai:autoSyncEnabled';
const NOTIFICATIONS_KEY = '@taskforceai:notificationsEnabled';
const REMOTE_TEXT_SCALE_KEY = '@taskforceai:remoteTextScale';
const REMOTE_CODE_SCALE_KEY = '@taskforceai:remoteCodeScale';
const REMOTE_WORD_WRAP_KEY = '@taskforceai:remoteWordWrap';
const logger = createModuleLogger('PreferencesContext');

interface PreferencesContextValue {
  autoSyncEnabled: boolean;
  setAutoSyncEnabled: (value: boolean) => Promise<void>;
  notificationsEnabled: boolean;
  setNotificationsEnabled: (value: boolean) => Promise<void>;
  remoteTextScale: number;
  setRemoteTextScale: (value: number) => Promise<void>;
  remoteCodeScale: number;
  setRemoteCodeScale: (value: number) => Promise<void>;
  remoteWordWrap: boolean;
  setRemoteWordWrap: (value: boolean) => Promise<void>;
  hasLoadedPreferences: boolean;
}

const PreferencesContext = createContext<PreferencesContextValue | undefined>(undefined);

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [autoSyncEnabled, setAutoSyncEnabledState] = useState(true);
  const [notificationsEnabled, setNotificationsEnabledState] = useState(true);
  const [remoteTextScale, setRemoteTextScaleState] = useState(1);
  const [remoteCodeScale, setRemoteCodeScaleState] = useState(1);
  const [remoteWordWrap, setRemoteWordWrapState] = useState(false);
  const [hasLoadedPreferences, setHasLoadedPreferences] = useState(false);

  useEffect(() => {
    let mounted = true;
    const loadPreferences = async () => {
      try {
        const [storedAutoSync, storedNotifications, storedTextScale, storedCodeScale, storedWordWrap] = await Promise.all([
          AsyncStorage.getItem(AUTO_SYNC_KEY),
          AsyncStorage.getItem(NOTIFICATIONS_KEY),
          AsyncStorage.getItem(REMOTE_TEXT_SCALE_KEY),
          AsyncStorage.getItem(REMOTE_CODE_SCALE_KEY),
          AsyncStorage.getItem(REMOTE_WORD_WRAP_KEY),
        ]);
        if (mounted && storedAutoSync !== null) {
          setAutoSyncEnabledState(storedAutoSync === 'true');
        }
        if (mounted && storedNotifications !== null) {
          setNotificationsEnabledState(storedNotifications === 'true');
        }
        if (mounted && storedTextScale !== null) setRemoteTextScaleState(clampScale(Number(storedTextScale)));
        if (mounted && storedCodeScale !== null) setRemoteCodeScaleState(clampScale(Number(storedCodeScale)));
        if (mounted && storedWordWrap !== null) setRemoteWordWrapState(storedWordWrap === 'true');
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

  const setRemoteTextScale = useCallback(async (value: number) => {
    const next = clampScale(value);
    setRemoteTextScaleState(next);
    await AsyncStorage.setItem(REMOTE_TEXT_SCALE_KEY, String(next));
  }, []);

  const setRemoteCodeScale = useCallback(async (value: number) => {
    const next = clampScale(value);
    setRemoteCodeScaleState(next);
    await AsyncStorage.setItem(REMOTE_CODE_SCALE_KEY, String(next));
  }, []);

  const setRemoteWordWrap = useCallback(async (value: boolean) => {
    setRemoteWordWrapState(value);
    await AsyncStorage.setItem(REMOTE_WORD_WRAP_KEY, String(value));
  }, []);

  const value = useMemo(
    () => ({
      autoSyncEnabled,
      setAutoSyncEnabled,
      notificationsEnabled,
      setNotificationsEnabled,
      remoteTextScale,
      setRemoteTextScale,
      remoteCodeScale,
      setRemoteCodeScale,
      remoteWordWrap,
      setRemoteWordWrap,
      hasLoadedPreferences,
    }),
    [autoSyncEnabled, setAutoSyncEnabled, notificationsEnabled, setNotificationsEnabled, remoteTextScale, setRemoteTextScale, remoteCodeScale, setRemoteCodeScale, remoteWordWrap, setRemoteWordWrap, hasLoadedPreferences]
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

const clampScale = (value: number): number =>
  Number.isFinite(value) ? Math.min(1.3, Math.max(0.8, Math.round(value * 10) / 10)) : 1;

export function usePreferences(): PreferencesContextValue {
  const context = useContext(PreferencesContext);
  if (!context) {
    throw new Error('usePreferences must be used within PreferencesProvider');
  }
  return context;
}
