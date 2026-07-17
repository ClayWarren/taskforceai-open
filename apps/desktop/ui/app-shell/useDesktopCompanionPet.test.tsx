import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../tests/setup/dom';

const getDesktopAppServerStatus = vi.fn();
const loggerDebug = vi.fn();

vi.mock('../platform/app-server', () => ({ getDesktopAppServerStatus }));
vi.mock('@taskforceai/web/app/lib/logger', () => ({
  logger: { debug: loggerDebug },
}));

import { useDesktopCompanionPet } from './useDesktopCompanionPet';

describe('useDesktopCompanionPet', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads, refreshes, reports failures, and cleans up the desktop companion', async () => {
    const clearInterval = vi.spyOn(window, 'clearInterval');
    getDesktopAppServerStatus
      .mockResolvedValueOnce({
        pet: { name: 'Scout', mood: 'idle', visible: true, message: 'Standing by' },
      })
      .mockRejectedValueOnce(new Error('offline'));
    const view = renderHook(({ enabled }) => useDesktopCompanionPet(enabled), {
      initialProps: { enabled: false },
    });
    expect(view.result.current).toBeNull();

    await act(async () => {
      view.rerender({ enabled: true });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(view.result.current).toEqual({
      name: 'Scout',
      mood: 'idle',
      visible: true,
      message: 'Standing by',
    });

    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(loggerDebug).toHaveBeenCalledWith('[App] Desktop companion unavailable', {
      error: expect.any(Error),
    });

    view.unmount();
    expect(clearInterval).toHaveBeenCalled();
  });
});
