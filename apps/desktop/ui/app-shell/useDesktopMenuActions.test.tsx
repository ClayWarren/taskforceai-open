import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, mock } from 'bun:test';

import '../../../../tests/setup/dom';

const loggerWarn = mock();
const pendingListeners: Array<(_unlisten: () => void) => void> = [];
const listenTauriEvent = mock(
  () =>
    new Promise<() => void>((resolve) => {
      pendingListeners.push(resolve);
    })
);

mock.module('../platform/bridge', () => ({ listenTauriEvent }));
mock.module('@taskforceai/web/app/lib/logger', () => ({ logger: { warn: loggerWarn } }));

import { useDesktopMenuActions } from './useDesktopMenuActions';

describe('useDesktopMenuActions', () => {
  afterEach(() => {
    cleanup();
    pendingListeners.length = 0;
    listenTauriEvent.mockClear();
    loggerWarn.mockClear();
  });

  it('unlistens when registration finishes after the hook was removed', async () => {
    const unlisteners = [mock(), mock(), mock()];
    const { unmount } = renderHook(() =>
      useDesktopMenuActions({
        desktopRuntime: true,
        onOpenBrowserPreview: mock(),
        onOpenSettings: mock(),
      })
    );

    expect(pendingListeners).toHaveLength(3);
    unmount();
    await act(async () => {
      pendingListeners.forEach((resolve, index) => resolve(unlisteners[index]!));
      await Promise.resolve();
    });

    for (const unlisten of unlisteners) expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it('reports listener registration failures', async () => {
    const error = new Error('menu unavailable');
    listenTauriEvent
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(mock())
      .mockResolvedValueOnce(mock());

    renderHook(() =>
      useDesktopMenuActions({
        desktopRuntime: true,
        onOpenBrowserPreview: mock(),
        onOpenSettings: mock(),
      })
    );

    await waitFor(() =>
      expect(loggerWarn).toHaveBeenCalledWith('Failed to register desktop menu listeners', {
        error,
      })
    );
  });
});
