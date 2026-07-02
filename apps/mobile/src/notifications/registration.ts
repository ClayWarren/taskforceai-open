import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { AppOwnership } from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { getMobileClient } from '../api/client';
import { createModuleLogger } from '../logger';

const PUSH_TOKEN_STORAGE_KEY = '@taskforceai:expoPushToken';
const logger = createModuleLogger('NotificationsRegistration');

const resolveProjectId = (): string => {
  const expoConfig = Constants.expoConfig ?? null;
  const legacyProjectId =
    (expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
    Constants.easConfig?.projectId ??
    '';
  return legacyProjectId;
};

type PermissionStatus = 'granted' | 'denied' | 'undetermined';

export type PushRegistrationResult =
  | { status: 'granted'; token: string }
  | { status: 'denied' | 'undetermined' };

const mapPermissionStatus = (
  status: Notifications.PermissionStatus
): PermissionStatus => {
  if (status === Notifications.PermissionStatus.GRANTED) return 'granted';
  if (status === Notifications.PermissionStatus.DENIED) return 'denied';
  return 'undetermined';
};

export async function ensurePushRegistration(
  options: { promptUser?: boolean } = {}
): Promise<PushRegistrationResult> {
  try {
    const isExpoGo = Constants.appOwnership === AppOwnership.Expo;

    if (isExpoGo && Platform.OS === 'android') {
      logger.info(
        'Skipping push registration in Expo Go on Android (not supported since SDK 53). Use a development build for full notification support.'
      );
      return { status: 'undetermined' };
    }

    if (!Device.isDevice) {
      logger.warn('Push notifications require a physical device.');
      return { status: 'undetermined' };
    }

    const projectId = resolveProjectId();
    if (!projectId) {
      logger.warn('Missing EAS project ID – cannot register for push notifications.');
      return { status: 'undetermined' };
    }

    const promptUser = options.promptUser ?? true;
    const currentSettings = await Notifications.getPermissionsAsync();
    let finalStatus = currentSettings.status;

    if (
      finalStatus !== Notifications.PermissionStatus.GRANTED &&
      promptUser &&
      currentSettings.canAskAgain
    ) {
      const requestResult = await Notifications.requestPermissionsAsync();
      finalStatus = requestResult.status;
    }

    if (finalStatus !== Notifications.PermissionStatus.GRANTED) {
      const mappedStatus = mapPermissionStatus(finalStatus);
      return { status: mappedStatus as 'denied' | 'undetermined' };
    }

    const pushTokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = pushTokenResponse.data;
    await AsyncStorage.setItem(PUSH_TOKEN_STORAGE_KEY, token);

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#ffffff',
      });
    }

    await syncTokenWithBackend(token);

    return { status: 'granted', token };
  } catch (error) {
    logger.error('Unexpected error during push registration', {
      error: error instanceof Error ? error.message : String(error),
      originalError: error
    });
    return { status: 'undetermined' };
  }
}

export async function unregisterPushNotifications(): Promise<void> {
  const token = await AsyncStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
  if (!token) {
    return;
  }
  try {
    const client = getMobileClient();
    await client.unregisterPushToken(token);
    await AsyncStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);
  } catch (error) {
    // Keep the token locally so a later logout/disable attempt can retry backend cleanup.
    logger.error('Failed to unregister push token with backend', { error });
  }
}

const resolveAppVersion = (): string => {
  const version = Constants.expoConfig?.version ?? '';
  return version;
};

const resolveDeviceIdentifier = (): string => {
  const candidates = [
    Device.osInternalBuildId,
    Device.osBuildId,
    Device.modelId,
    Device.deviceName,
  ];

  const firstString = candidates.find((value): value is string => typeof value === 'string');
  return firstString ?? '';
};

async function syncTokenWithBackend(token: string): Promise<void> {
  try {
    const client = getMobileClient();
    await client.registerPushToken({
      token,
      platform: Platform.OS ?? 'unknown',
      deviceId: resolveDeviceIdentifier(),
      appVersion: resolveAppVersion(),
    });
  } catch (error) {
    logger.error('Failed to sync push token with backend', { error });
    throw error;
  }
}
