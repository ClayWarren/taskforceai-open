import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, mock } from 'bun:test';

import '../../../../../tests/setup/dom';

import { TauriReadySignal } from './TauriReadySignal';

const mockDetectRuntime = mock(() => 'browser');
const mockInvokeTauri = mock(() => Promise.resolve(undefined));
const mockPlatformWarn = mock(() => undefined);

mock.module('@taskforceai/shared/utils/runtime', () => ({
  detectRuntime: mockDetectRuntime,
}));

mock.module('./desktop/bridge', () => ({
  invokeTauri: mockInvokeTauri,
}));

mock.module('../logger', () => ({
  logger: {
    warn: mockPlatformWarn,
  },
}));

describe('TauriReadySignal', () => {
  beforeEach(() => {
    mockDetectRuntime.mockClear();
    mockInvokeTauri.mockClear();
    mockPlatformWarn.mockClear();
  });

  it('signals Tauri readiness when runtime is desktop', async () => {
    mockDetectRuntime.mockReturnValue('desktop');

    render(<TauriReadySignal />);

    await waitFor(() => {
      expect(mockInvokeTauri).toHaveBeenCalledWith('frontend_ready');
    });
  });

  it('does not signal readiness for browser runtime', () => {
    mockDetectRuntime.mockReturnValue('browser');

    render(<TauriReadySignal />);

    expect(mockInvokeTauri).not.toHaveBeenCalled();
  });

  it('logs readiness signal failures while mounted', async () => {
    const error = new Error('ipc unavailable');
    mockDetectRuntime.mockReturnValue('desktop');
    mockInvokeTauri.mockRejectedValueOnce(error);

    render(<TauriReadySignal />);

    await waitFor(() => {
      expect(mockPlatformWarn).toHaveBeenCalledWith('Failed to signal Tauri frontend readiness', {
        error,
      });
    });
  });

  it('suppresses readiness failure logs after unmount', async () => {
    mockDetectRuntime.mockReturnValue('desktop');
    let rejectReady: (error: Error) => void = () => {};
    mockInvokeTauri.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectReady = reject;
        })
    );

    const { unmount } = render(<TauriReadySignal />);
    await waitFor(() => {
      expect(mockInvokeTauri).toHaveBeenCalledWith('frontend_ready');
    });

    unmount();
    rejectReady(new Error('late failure'));
    await Promise.resolve();

    expect(mockPlatformWarn).not.toHaveBeenCalled();
  });
});
