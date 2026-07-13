import { voiceManager } from '@taskforceai/voice';
import Constants, { AppOwnership } from 'expo-constants';
import * as Notifications from 'expo-notifications';
import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import '../../nativewind.generated.css';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { AuthProvider } from '../contexts/AuthContext';
import { LanguageProvider } from '../contexts/LanguageContext';
import { PreferencesProvider, usePreferences } from '../contexts/PreferencesContext';
import { SyncProvider } from '../contexts/SyncContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import { sqliteStorage } from '../storage/sqlite-adapter';
import { useNotificationsBootstrap } from '../hooks/useNotificationsBootstrap';

import { useCacheCleanup } from '../hooks/useCacheCleanup';
import { useStreamingAutoAbort } from '../streaming/useStreamingStore';
import { QueryProvider } from './QueryProvider';
import { useTypography } from '../theme/useTypography';
import { MobileVoiceAdapter } from '../voice/mobileAdapter';
import { mobileMetrics } from '../observability/metrics';
import { authClient } from '@taskforceai/api-client/auth/auth-client';
import { mobileEnv } from '../config/env';
import { getMobileBaseUrl } from '../config/base-url';
import { getMobileClient, getMobilePinnedFetch } from '../api/client';
import { setBrowserClient } from '@taskforceai/api-client/browserClient';

// Mark the very beginning of the JS bundle execution
const STARTUP_TIME = Date.now();
const isE2ESyncDisabled = mobileEnv.flags.disableE2ESync;

// Configure shared auth client for mobile immediately on module load
authClient.configure({
  baseUrl: getMobileBaseUrl(),
  fetchImpl: getMobilePinnedFetch(),
  getTokenProvider: async () => {
    const sessionRes = await sqliteStorage.getSession();
    return sessionRes.ok ? sessionRes.value.accessToken : null;
  },
});

// Mirror mobile API client to browserClient for profile fetching immediately
setBrowserClient(getMobileClient());

const isExpoGo = Constants.appOwnership === AppOwnership.Expo;
const shouldInitializeNotifications = !(isExpoGo && Platform.OS === 'android');

type AppProvidersProps = {
  children: React.ReactNode;
};

export default function AppProviders({ children }: AppProvidersProps) {
  const startupInteractiveReported = useRef(false);

  useEffect(() => {
    voiceManager.setAdapter(new MobileVoiceAdapter());
  }, []);

  useEffect(() => {
    // Report startup duration once
    const duration = Date.now() - STARTUP_TIME;
    mobileMetrics.incrementCounter('app.start.duration', { duration_ms: duration });
    mobileMetrics.incrementCounter('app.start.success');
  }, []);

  useCacheCleanup();
  useStreamingAutoAbort();

  useEffect(() => {
    if (!shouldInitializeNotifications) {
      return;
    }
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
  }, []);

  const fontsReady = useTypography();

  useEffect(() => {
    if (!fontsReady || startupInteractiveReported.current) {
      return;
    }

    startupInteractiveReported.current = true;
    const duration = Date.now() - STARTUP_TIME;
    mobileMetrics.incrementCounter('app.start.interactive', { duration_ms: duration });
    mobileMetrics.incrementCounter('app.start.fonts_ready');
  }, [fontsReady]);

  if (!fontsReady) {
    return (
      <View style={loadingStyles.container}>
        <ActivityIndicator size="large" color="#818cf8" />
      </View>
    );
  }

  return (
    <ErrorBoundary>
      <LanguageProvider>
        <PreferencesProvider>
          <ThemeProvider>
            <SafeAreaProvider>
              <QueryProvider>
                <AuthProvider>
                  <SyncWithPreferences>{children}</SyncWithPreferences>
                </AuthProvider>
              </QueryProvider>
            </SafeAreaProvider>
          </ThemeProvider>
        </PreferencesProvider>
      </LanguageProvider>
    </ErrorBoundary>
  );
}

function SyncWithPreferences({ children }: { children: React.ReactNode }) {
  const { autoSyncEnabled } = usePreferences();
  const syncEnabled = autoSyncEnabled && !isE2ESyncDisabled;

  return (
    <NotificationBootstrap>
      <SyncProvider enabled={syncEnabled}>
        {children}
      </SyncProvider>
    </NotificationBootstrap>
  );
}

function NotificationBootstrap({ children }: { children: React.ReactNode }) {
  useNotificationsBootstrap();
  return <>{children}</>;
}

const loadingStyles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#05060f',
  },
});
