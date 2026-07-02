import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../tests/setup/dom';

const initializeDesktopAppServerMock = vi.fn();
const invokeTauriMock = vi.fn();
const loggerErrorMock = vi.fn();

vi.mock('../lib/platform/desktop/app-server', () => ({
  initializeDesktopAppServer: initializeDesktopAppServerMock,
}));

vi.mock('../lib/platform/desktop/bridge', () => ({
  invokeTauri: invokeTauriMock,
}));

vi.mock('../lib/logger', () => ({
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
    window.alert = vi.fn();
    window.confirm = vi.fn();
  });

  it('is inert outside the desktop runtime', () => {
    const { result } = renderHook(() => useDesktopShellActions('browser'));

    expect(result.current.availableUpdate).toBeNull();
    expect(result.current.handleCheckForUpdates).toBeUndefined();
    expect(initializeDesktopAppServerMock).not.toHaveBeenCalled();
  });

  it('initializes desktop app-server and alerts when the app is current', async () => {
    const { result } = renderHook(() => useDesktopShellActions('desktop'));

    await waitFor(() => expect(initializeDesktopAppServerMock).toHaveBeenCalled());

    await act(async () => {
      result.current.handleCheckForUpdates?.();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(window.alert).toHaveBeenCalledWith('TaskForceAI is up to date (1.0.0).')
    );
    expect(result.current.availableUpdate).toBeNull();
  });

  it('stores available update state and installs after confirmation', async () => {
    invokeTauriMock.mockResolvedValueOnce({
      available: true,
      currentVersion: '1.0.0',
      version: '1.1.0',
    });
    (window.confirm as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const { result } = renderHook(() => useDesktopShellActions('desktop'));

    await act(async () => {
      result.current.handleCheckForUpdates?.();
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.availableUpdate?.version).toBe('1.1.0'));
    expect(window.confirm).toHaveBeenCalledWith('TaskForceAI 1.1.0 is available. Install it now?');
    expect(invokeTauriMock).toHaveBeenNthCalledWith(2, 'desktop_update_install');
  });

  it('alerts and logs when the update check fails', async () => {
    invokeTauriMock.mockRejectedValueOnce(new Error('network down'));
    const { result } = renderHook(() => useDesktopShellActions('desktop'));

    await act(async () => {
      result.current.handleCheckForUpdates?.();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(window.alert).toHaveBeenCalledWith(
        'Could not check for updates. Please try again later.'
      )
    );
    expect(loggerErrorMock).toHaveBeenCalled();
  });
});
