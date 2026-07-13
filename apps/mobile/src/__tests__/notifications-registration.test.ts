import AsyncStorage from '@react-native-async-storage/async-storage';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as Notifications from 'expo-notifications';

const mockRegisterPushToken = jest.fn(async () => undefined);
const mockUnregisterPushToken = jest.fn(async () => undefined);

jest.mock('../api/client', () => ({
  getMobileClient: () => ({
    registerPushToken: mockRegisterPushToken,
    unregisterPushToken: mockUnregisterPushToken,
  }),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  AppOwnership: {
    Expo: 'expo',
    Standalone: 'standalone',
    Guest: 'guest',
  },
  default: {
    appOwnership: 'standalone',
    expoConfig: {
      version: '1.2.3',
      extra: { eas: { projectId: 'project-123' } },
    },
    easConfig: {
      projectId: 'project-123',
    },
  },
}));

jest.mock('expo-device', () => ({
  isDevice: true,
  osInternalBuildId: 'build-123',
  osBuildId: 'os-build-456',
  modelId: 'model-789',
  deviceName: 'test-device',
}));

import {
  ensurePushRegistration,
  unregisterPushNotifications,
} from '../notifications/registration';

describe('notifications registration', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    (Notifications as any).PermissionStatus = {
      GRANTED: 'granted',
      DENIED: 'denied',
      UNDETERMINED: 'undetermined',
    };
    (Notifications as any).AndroidImportance = {
      MAX: 7,
    };

    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({
      status: 'granted',
      canAskAgain: true,
    });
    (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({
      status: 'granted',
      canAskAgain: false,
    });
    (Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({
      data: 'ExponentPushToken[mock-token]',
    });
    (Notifications.setNotificationChannelAsync as jest.Mock).mockResolvedValue(undefined);
  });

  it('returns denied when permission is denied', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({
      status: 'denied',
      canAskAgain: false,
    });

    const result = await ensurePushRegistration({ promptUser: true });

    expect(result).toEqual({ status: 'denied' });
    expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(mockRegisterPushToken).not.toHaveBeenCalled();
  });

  it('stores token and syncs backend when permission is granted', async () => {
    const result = await ensurePushRegistration({ promptUser: false });

    expect(result).toEqual({
      status: 'granted',
      token: 'ExponentPushToken[mock-token]',
    });
    expect(mockRegisterPushToken).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'ExponentPushToken[mock-token]',
        appVersion: expect.any(String),
      })
    );
    await expect(AsyncStorage.getItem('@taskforceai:expoPushToken')).resolves.toBe(
      'ExponentPushToken[mock-token]'
    );
  });

  it('clears local token and unregisters backend token', async () => {
    await AsyncStorage.setItem('@taskforceai:expoPushToken', 'ExponentPushToken[saved]');

    await unregisterPushNotifications();

    expect(mockUnregisterPushToken).toHaveBeenCalledWith('ExponentPushToken[saved]');
    await expect(AsyncStorage.getItem('@taskforceai:expoPushToken')).resolves.toBeNull();
  });

  it('keeps local token when backend unregister fails so cleanup can retry', async () => {
    await AsyncStorage.setItem('@taskforceai:expoPushToken', 'ExponentPushToken[saved]');
    mockUnregisterPushToken.mockRejectedValueOnce(new Error('offline'));

    await unregisterPushNotifications();

    expect(mockUnregisterPushToken).toHaveBeenCalledWith('ExponentPushToken[saved]');
    await expect(AsyncStorage.getItem('@taskforceai:expoPushToken')).resolves.toBe(
      'ExponentPushToken[saved]'
    );
  });

  it('does not call backend unregister when no token exists', async () => {
    await unregisterPushNotifications();

    expect(mockUnregisterPushToken).not.toHaveBeenCalled();
  });
});
