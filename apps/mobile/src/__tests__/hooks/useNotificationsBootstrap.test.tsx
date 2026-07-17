import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useAuth } from '../../contexts/AuthContext';
import { usePreferences } from '../../contexts/PreferencesContext';
import { useNotificationsBootstrap } from '../../hooks/useNotificationsBootstrap';
import {
  ensurePushRegistration,
  unregisterPushNotifications,
} from '../../notifications/registration';

jest.mock('../../contexts/PreferencesContext', () => ({
  usePreferences: jest.fn(),
}));

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../../notifications/registration', () => ({
  ensurePushRegistration: jest.fn(),
  unregisterPushNotifications: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: jest.fn(),
}));

jest.mock('../../logger', () => ({
  createModuleLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

const createDeferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const mockUsePreferences = usePreferences as jest.MockedFunction<typeof usePreferences>;
const mockUseAuth = jest.mocked(useAuth);
const mockEnsurePushRegistration =
  ensurePushRegistration as jest.MockedFunction<typeof ensurePushRegistration>;
const mockUnregisterPushNotifications =
  unregisterPushNotifications as jest.MockedFunction<typeof unregisterPushNotifications>;
const mockUseTranslation = useTranslation as jest.MockedFunction<typeof useTranslation>;

const mockSetNotificationsEnabled = jest.fn(async () => undefined);

describe('useNotificationsBootstrap', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockUseTranslation.mockReturnValue({
      t: (key: string) => `translated:${key}`,
      i18n: {} as never,
    });

    mockUseAuth.mockReturnValue({
      user: { id: 1, email: 'test@example.com', plan: 'free' } as never,
      isAuthenticated: true,
      isLoading: false,
      logout: jest.fn(async () => undefined),
      refreshUser: jest.fn(async () => undefined),
    });

    mockUsePreferences.mockReturnValue({
      autoSyncEnabled: true,
      setAutoSyncEnabled: jest.fn(async () => undefined),
      notificationsEnabled: true,
      setNotificationsEnabled: mockSetNotificationsEnabled,
      hasLoadedPreferences: true,
    });

    mockEnsurePushRegistration.mockResolvedValue({
      status: 'granted',
      token: 'ExponentPushToken[mock-token]',
    });
    mockUnregisterPushNotifications.mockResolvedValue(undefined);

    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  it('registers notifications when enabled', async () => {
    await renderHook(() => useNotificationsBootstrap());

    await waitFor(() => {
      expect(mockEnsurePushRegistration).toHaveBeenCalledWith({ promptUser: false });
    });

    expect(mockUnregisterPushNotifications).not.toHaveBeenCalled();
    expect(mockSetNotificationsEnabled).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('unregisters notifications when disabled', async () => {
    mockUsePreferences.mockReturnValue({
      autoSyncEnabled: true,
      setAutoSyncEnabled: jest.fn(async () => undefined),
      notificationsEnabled: false,
      setNotificationsEnabled: mockSetNotificationsEnabled,
      hasLoadedPreferences: true,
    });

    await renderHook(() => useNotificationsBootstrap());

    await waitFor(() => {
      expect(mockUnregisterPushNotifications).toHaveBeenCalledTimes(1);
    });

    expect(mockEnsurePushRegistration).not.toHaveBeenCalled();
    expect(mockSetNotificationsEnabled).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('disables the preference and alerts when permission is denied', async () => {
    mockEnsurePushRegistration.mockResolvedValueOnce({ status: 'denied' });

    await renderHook(() => useNotificationsBootstrap());

    await waitFor(() => {
      expect(mockSetNotificationsEnabled).toHaveBeenCalledWith(false);
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      'translated:mobile.settings.notificationsSystemDisabledTitle',
      'translated:mobile.settings.notificationsSystemDisabledMessage'
    );
  });

  it('does not disable the preference when permission is undetermined', async () => {
    mockEnsurePushRegistration.mockResolvedValueOnce({ status: 'undetermined' });

    await renderHook(() => useNotificationsBootstrap());

    await waitFor(() => {
      expect(mockEnsurePushRegistration).toHaveBeenCalledWith({ promptUser: false });
    });

    expect(mockSetNotificationsEnabled).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('waits for preferences to load before registering', async () => {
    mockUsePreferences.mockReturnValue({
      autoSyncEnabled: true,
      setAutoSyncEnabled: jest.fn(async () => undefined),
      notificationsEnabled: true,
      setNotificationsEnabled: mockSetNotificationsEnabled,
      hasLoadedPreferences: false,
    });

    await renderHook(() => useNotificationsBootstrap());

    expect(mockEnsurePushRegistration).not.toHaveBeenCalled();
    expect(mockUnregisterPushNotifications).not.toHaveBeenCalled();
  });

  it('skips registration while auth state is loading', async () => {
    mockUseAuth.mockReturnValue({
      user: null,
      isAuthenticated: false,
      isLoading: true,
      logout: jest.fn(async () => undefined),
      refreshUser: jest.fn(async () => undefined),
    });

    await renderHook(() => useNotificationsBootstrap());

    expect(mockEnsurePushRegistration).not.toHaveBeenCalled();
    expect(mockUnregisterPushNotifications).not.toHaveBeenCalled();
  });

  it('unregisters notifications after logout', async () => {
    mockUseAuth.mockReturnValue({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      logout: jest.fn(async () => undefined),
      refreshUser: jest.fn(async () => undefined),
    });

    await renderHook(() => useNotificationsBootstrap());

    await waitFor(() => {
      expect(mockUnregisterPushNotifications).toHaveBeenCalledTimes(1);
    });
    expect(mockEnsurePushRegistration).not.toHaveBeenCalled();
  });

  it('skips alert and preference updates after unmount', async () => {
    const permissionGate = createDeferred<{ status: 'denied' }>();
    mockEnsurePushRegistration.mockReturnValueOnce(permissionGate.promise);

    const { unmount } = await renderHook(() => useNotificationsBootstrap());

    await unmount();

    await act(async () => {
      permissionGate.resolve({ status: 'denied' });
      await permissionGate.promise;
      await Promise.resolve();
    });

    expect(mockSetNotificationsEnabled).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});
