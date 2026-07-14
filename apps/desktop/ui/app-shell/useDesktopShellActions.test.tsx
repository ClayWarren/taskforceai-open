import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../tests/setup/dom';

const initializeDesktopAppServerMock = vi.fn();
const invokeTauriMock = vi.fn();
const loggerErrorMock = vi.fn();
const confirmDialogMock = vi.fn();

vi.mock('../platform/app-server', () => ({
  initializeDesktopAppServer: initializeDesktopAppServerMock,
}));

vi.mock('../platform/bridge', () => ({
  invokeTauri: invokeTauriMock,
}));

vi.mock('@taskforceai/web/app/lib/platform/confirm-dialog', () => ({
  confirmDialog: confirmDialogMock,
}));

vi.mock('@taskforceai/web/app/lib/logger', () => ({
  logger: {
    error: loggerErrorMock,
    warn: vi.fn(),
  },
}));

import { useDesktopShellActions } from './useDesktopShellActions';

describe('useDesktopShellActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initializeDesktopAppServerMock.mockResolvedValue(undefined);
    invokeTauriMock.mockResolvedValue({
      available: false,
      currentVersion: '1.0.0',
      version: null,
    });
    confirmDialogMock.mockResolvedValue(true);
  });

  it('is inert outside the desktop runtime', () => {
    const { result } = renderHook(() => useDesktopShellActions('browser'));

    expect(result.current.availableUpdate).toBeNull();
    expect(result.current.desktopUpdateAction).toBe('idle');
    expect(result.current.desktopUpdateMessage).toBeNull();
    expect(result.current.handleCheckForUpdates).toBeUndefined();
    expect(initializeDesktopAppServerMock).not.toHaveBeenCalled();
  });

  it('initializes desktop app-server and reports when the app is current', async () => {
    const { result } = renderHook(() => useDesktopShellActions('desktop'));

    await waitFor(() => expect(initializeDesktopAppServerMock).toHaveBeenCalled());

    await act(async () => {
      result.current.handleCheckForUpdates?.();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(result.current.desktopUpdateMessage).toBe('TaskForceAI is up to date (1.0.0).')
    );
    expect(result.current.availableUpdate).toBeNull();
    expect(result.current.desktopUpdateAction).toBe('idle');
  });

  it('stores available update state and installs after confirmation', async () => {
    invokeTauriMock.mockResolvedValueOnce({
      available: true,
      currentVersion: '1.0.0',
      version: '1.1.0',
    });
    confirmDialogMock.mockResolvedValue(true);

    const { result } = renderHook(() => useDesktopShellActions('desktop'));

    await act(async () => {
      result.current.handleCheckForUpdates?.();
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.availableUpdate?.version).toBe('1.1.0'));
    expect(confirmDialogMock).toHaveBeenCalledWith(
      'TaskForceAI 1.1.0 is ready to install. The app will restart after the update is applied.',
      {
        title: 'Install Update',
        confirmLabel: 'Install',
      }
    );
    expect(invokeTauriMock).toHaveBeenNthCalledWith(2, 'desktop_update_install');
  });

  it('installs a stored available update without checking again', async () => {
    confirmDialogMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    invokeTauriMock.mockResolvedValueOnce({
      available: true,
      currentVersion: '1.0.0',
      version: '1.1.0',
    });

    const { result } = renderHook(() => useDesktopShellActions('desktop'));

    await act(async () => {
      result.current.handleCheckForUpdates?.();
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.availableUpdate?.version).toBe('1.1.0'));
    expect(invokeTauriMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.handleCheckForUpdates?.();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(invokeTauriMock).toHaveBeenNthCalledWith(2, 'desktop_update_install')
    );
    expect(invokeTauriMock).toHaveBeenCalledTimes(2);
  });

  it('reports and logs when the update check fails', async () => {
    invokeTauriMock.mockRejectedValueOnce(new Error('network down'));
    const { result } = renderHook(() => useDesktopShellActions('desktop'));

    await act(async () => {
      result.current.handleCheckForUpdates?.();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(result.current.desktopUpdateMessage).toBe(
        'Could not check for updates. Please try again later.'
      )
    );
    expect(loggerErrorMock).toHaveBeenCalled();
  });

  it('points to the manual installer when automatic update installation fails', async () => {
    invokeTauriMock
      .mockResolvedValueOnce({
        available: true,
        currentVersion: '1.0.0',
        version: '1.1.0',
      })
      .mockRejectedValueOnce(new Error('permission denied'));

    const { result } = renderHook(() => useDesktopShellActions('desktop'));

    await act(async () => {
      result.current.handleCheckForUpdates?.();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(result.current.desktopUpdateMessage).toBe(
        'Could not install the update automatically. Download the latest desktop installer from taskforceai.chat/downloads.'
      )
    );
    expect(loggerErrorMock).toHaveBeenCalled();
    expect(result.current.availableUpdate?.version).toBe('1.1.0');
    expect(result.current.desktopUpdateAction).toBe('idle');
  });
});
