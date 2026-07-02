import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../../tests/setup/dom';

const invokeTauriMock = vi.fn();
const loggerErrorMock = vi.fn();

vi.mock('../../../lib/platform/desktop/bridge', () => ({
  invokeTauri: invokeTauriMock,
}));

vi.mock('../../../lib/logger', () => ({
  logger: {
    error: loggerErrorMock,
  },
}));

import { useLockedComputerUseStatus } from './useLockedComputerUseStatus';

describe('useLockedComputerUseStatus', () => {
  const setErrorMessage = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    invokeTauriMock.mockResolvedValue({
      enabled: false,
      installed: true,
      installPath: '/usr/local/bin/locked-computer-use',
      message: 'Ready',
      packaged: true,
      packagePath: '/Applications/TaskForceAI.app/locked-computer-use',
      requiresInstall: false,
      supported: true,
    });
  });

  it('does not query Tauri outside the desktop runtime', () => {
    const { result } = renderHook(() =>
      useLockedComputerUseStatus({ platformRuntime: 'browser', setErrorMessage })
    );

    expect(result.current.lockedComputerUseStatus).toBeNull();
    expect(invokeTauriMock).not.toHaveBeenCalled();
  });

  it('loads status and toggles enablement through the desktop command', async () => {
    invokeTauriMock
      .mockResolvedValueOnce({
        enabled: false,
        installed: true,
        requiresInstall: false,
        supported: true,
      })
      .mockResolvedValueOnce({
        enabled: true,
        installed: true,
        requiresInstall: false,
        supported: true,
      });

    const { result } = renderHook(() =>
      useLockedComputerUseStatus({ platformRuntime: 'desktop', setErrorMessage })
    );

    await waitFor(() => expect(result.current.lockedComputerUseStatus?.enabled).toBe(false));

    act(() => {
      result.current.toggleLockedComputerUse();
    });

    await waitFor(() => expect(result.current.lockedComputerUseStatus?.enabled).toBe(true));
    expect(invokeTauriMock).toHaveBeenNthCalledWith(
      1,
      'locked_computer_use_status',
      undefined,
      expect.any(Function)
    );
    expect(invokeTauriMock).toHaveBeenNthCalledWith(
      2,
      'set_locked_computer_use_enabled',
      { enabled: true },
      expect.any(Function)
    );
  });

  it('normalizes desktop status values through the Tauri parser', async () => {
    invokeTauriMock.mockImplementationOnce(async (_command, _args, parser) =>
      parser({
        enabled: 1,
        installed: 'yes',
        installPath: 42,
        message: 123,
        packaged: '',
        packagePath: '/Applications/TaskForceAI.app/locked-computer-use',
        requiresInstall: 0,
        supported: true,
      })
    );

    const { result } = renderHook(() =>
      useLockedComputerUseStatus({ platformRuntime: 'desktop', setErrorMessage })
    );

    await waitFor(() => expect(result.current.lockedComputerUseStatus).not.toBeNull());
    expect(result.current.lockedComputerUseStatus).toEqual({
      enabled: true,
      installed: true,
      installPath: null,
      message: '',
      packaged: false,
      packagePath: '/Applications/TaskForceAI.app/locked-computer-use',
      requiresInstall: false,
      supported: true,
    });
  });

  it('logs invalid or failed status loads without surfacing a prompt error', async () => {
    invokeTauriMock.mockRejectedValueOnce(new Error('status unavailable'));

    const { result } = renderHook(() =>
      useLockedComputerUseStatus({ platformRuntime: 'desktop', setErrorMessage })
    );

    await waitFor(() =>
      expect(loggerErrorMock).toHaveBeenCalledWith('Failed to load locked computer use status', {
        error: expect.any(Error),
      })
    );
    expect(result.current.lockedComputerUseStatus).toBeNull();
    expect(setErrorMessage).not.toHaveBeenCalled();
  });

  it('does not toggle until desktop status has loaded', () => {
    invokeTauriMock.mockImplementationOnce(() => new Promise(() => {}));

    const { result } = renderHook(() =>
      useLockedComputerUseStatus({ platformRuntime: 'desktop', setErrorMessage })
    );

    act(() => {
      result.current.toggleLockedComputerUse();
    });

    expect(invokeTauriMock).toHaveBeenCalledTimes(1);
    expect(setErrorMessage).not.toHaveBeenCalled();
  });

  it('installs packaged support when the status requires installation', async () => {
    invokeTauriMock
      .mockResolvedValueOnce({
        enabled: false,
        installed: false,
        requiresInstall: true,
        supported: true,
      })
      .mockResolvedValueOnce({
        enabled: true,
        installed: true,
        requiresInstall: false,
        supported: true,
      });

    const { result } = renderHook(() =>
      useLockedComputerUseStatus({ platformRuntime: 'desktop', setErrorMessage })
    );

    await waitFor(() => expect(result.current.lockedComputerUseStatus?.requiresInstall).toBe(true));

    act(() => {
      result.current.toggleLockedComputerUse();
    });

    await waitFor(() =>
      expect(invokeTauriMock).toHaveBeenLastCalledWith(
        'install_locked_computer_use',
        undefined,
        expect.any(Function)
      )
    );
  });

  it('reports toggle errors to the prompt form', async () => {
    invokeTauriMock
      .mockResolvedValueOnce({
        enabled: false,
        installed: true,
        requiresInstall: false,
        supported: true,
      })
      .mockRejectedValueOnce(new Error('permission denied'));

    const { result } = renderHook(() =>
      useLockedComputerUseStatus({ platformRuntime: 'desktop', setErrorMessage })
    );

    await waitFor(() => expect(result.current.lockedComputerUseStatus).not.toBeNull());

    act(() => {
      result.current.toggleLockedComputerUse();
    });

    await waitFor(() => expect(setErrorMessage).toHaveBeenCalledWith('permission denied'));
    expect(loggerErrorMock).toHaveBeenCalled();
  });

  it('reports non-Error toggle failures as strings', async () => {
    invokeTauriMock
      .mockResolvedValueOnce({
        enabled: true,
        installed: true,
        requiresInstall: false,
        supported: true,
      })
      .mockRejectedValueOnce('bridge offline');

    const { result } = renderHook(() =>
      useLockedComputerUseStatus({ platformRuntime: 'desktop', setErrorMessage })
    );

    await waitFor(() => expect(result.current.lockedComputerUseStatus).not.toBeNull());

    act(() => {
      result.current.toggleLockedComputerUse();
    });

    await waitFor(() => expect(setErrorMessage).toHaveBeenCalledWith('bridge offline'));
    expect(invokeTauriMock).toHaveBeenLastCalledWith(
      'set_locked_computer_use_enabled',
      { enabled: false },
      expect.any(Function)
    );
  });
});
