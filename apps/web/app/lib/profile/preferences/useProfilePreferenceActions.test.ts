import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../../tests/setup/dom';

const updateUserSettingsMock = vi.fn();
const updateDesktopAppServerLocalSettingsMock = vi.fn();
const usePlatformRuntimeMock = vi.fn();
const refreshUserMock = vi.fn();
const loggerErrorMock = vi.fn();

vi.mock('@taskforceai/api-client/api/account', () => ({
  updateUserSettings: updateUserSettingsMock,
}));

vi.mock('../../platform/desktop-api', () => ({
  updateDesktopAppServerLocalSettings: updateDesktopAppServerLocalSettingsMock,
}));

vi.mock('../../platform/PlatformProvider', () => ({
  usePlatformRuntime: usePlatformRuntimeMock,
}));

vi.mock('../../providers/AuthProvider', () => ({
  useAuth: () => ({
    refreshUser: refreshUserMock,
  }),
}));

vi.mock('../../logger', () => ({
  logger: {
    error: loggerErrorMock,
  },
}));

import { useProfilePreferenceActions } from './useProfilePreferenceActions';

const renderActions = () => {
  const setFeedbackKind = vi.fn();
  const setFeedbackMessage = vi.fn();
  const hook = renderHook(() =>
    useProfilePreferenceActions({
      setFeedbackKind,
      setFeedbackMessage,
    })
  );

  return {
    ...hook,
    setFeedbackKind,
    setFeedbackMessage,
  };
};

describe('useProfilePreferenceActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePlatformRuntimeMock.mockReturnValue('browser');
    updateUserSettingsMock.mockResolvedValue({ ok: true, value: {} });
    updateDesktopAppServerLocalSettingsMock.mockResolvedValue(undefined);
    refreshUserMock.mockResolvedValue(undefined);
  });

  it('persists web preference updates and refreshes the authenticated user', async () => {
    const { result, setFeedbackKind, setFeedbackMessage } = renderActions();

    await result.current.handleMemoryToggle(false);

    expect(updateUserSettingsMock).toHaveBeenCalledWith({ memory_enabled: false });
    expect(updateDesktopAppServerLocalSettingsMock).not.toHaveBeenCalled();
    expect(setFeedbackKind).toHaveBeenCalledWith('success');
    expect(setFeedbackMessage).toHaveBeenCalledWith('Preference updated.');
    expect(refreshUserMock).toHaveBeenCalledWith({ force: true });
  });

  it('routes desktop preference updates through the app server without refreshing web auth', async () => {
    usePlatformRuntimeMock.mockReturnValue('desktop');
    const { result, setFeedbackKind, setFeedbackMessage } = renderActions();

    await result.current.handleThemeChange('dark');

    expect(updateDesktopAppServerLocalSettingsMock).toHaveBeenCalledWith({ theme: 'dark' });
    expect(updateUserSettingsMock).not.toHaveBeenCalled();
    expect(refreshUserMock).not.toHaveBeenCalled();
    expect(setFeedbackKind).toHaveBeenCalledWith('success');
    expect(setFeedbackMessage).toHaveBeenCalledWith('Preference updated.');
  });

  it('reports web update failures without refreshing the user', async () => {
    const error = new Error('settings api failed');
    updateUserSettingsMock.mockResolvedValue({ ok: false, error });
    const { result, setFeedbackKind, setFeedbackMessage } = renderActions();

    await result.current.handleWebSearchToggle(true);

    expect(loggerErrorMock).toHaveBeenCalledWith('Failed to toggle web search setting', {
      error,
      settings: { web_search_enabled: true },
    });
    expect(setFeedbackKind).toHaveBeenCalledWith('error');
    expect(setFeedbackMessage).toHaveBeenCalledWith('Failed to update web search setting.');
    expect(refreshUserMock).not.toHaveBeenCalled();
  });

  it('reports desktop update failures with the attempted local settings', async () => {
    usePlatformRuntimeMock.mockReturnValue('desktop');
    const error = new Error('local app server failed');
    updateDesktopAppServerLocalSettingsMock.mockRejectedValue(error);
    const { result, setFeedbackKind, setFeedbackMessage } = renderActions();

    await result.current.handleCodeExecutionToggle(true);

    await waitFor(() => {
      expect(loggerErrorMock).toHaveBeenCalledWith('Failed to toggle code execution setting', {
        error,
        settings: { codeExecutionEnabled: true },
      });
    });
    expect(setFeedbackKind).toHaveBeenCalledWith('error');
    expect(setFeedbackMessage).toHaveBeenCalledWith('Failed to update code execution setting.');
  });

  it('maps each preference action to the expected web and desktop setting keys', async () => {
    const { result } = renderActions();

    await result.current.handleTrustLayerToggle(false);
    await result.current.handleNotificationsToggle(true);

    expect(updateUserSettingsMock).toHaveBeenNthCalledWith(1, { trust_layer_enabled: false });
    expect(updateUserSettingsMock).toHaveBeenNthCalledWith(2, { notifications_enabled: true });

    usePlatformRuntimeMock.mockReturnValue('desktop');
    const desktop = renderActions();

    await desktop.result.current.handleTrustLayerToggle(true);
    await desktop.result.current.handleNotificationsToggle(false);

    expect(updateDesktopAppServerLocalSettingsMock).toHaveBeenNthCalledWith(1, {
      trustLayerEnabled: true,
    });
    expect(updateDesktopAppServerLocalSettingsMock).toHaveBeenNthCalledWith(2, {
      notificationsEnabled: false,
    });
  });
});
