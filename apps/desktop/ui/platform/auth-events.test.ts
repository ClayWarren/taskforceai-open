import { describe, expect, it, vi } from 'bun:test';

import '../../../../tests/setup/dom';
import {
  DESKTOP_APP_SERVER_AUTH_CHANGED_EVENT,
  dispatchDesktopAppServerAuthChanged,
} from './auth-events';

describe('desktop auth events', () => {
  it('dispatches the shared auth change event in browser runtimes', () => {
    const dispatchEvent = vi.spyOn(window, 'dispatchEvent');

    dispatchDesktopAppServerAuthChanged();

    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: DESKTOP_APP_SERVER_AUTH_CHANGED_EVENT })
    );
  });

  it('does nothing when no browser window is available', () => {
    const browserWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', { configurable: true, value: undefined });

    expect(dispatchDesktopAppServerAuthChanged()).toBeUndefined();

    if (browserWindow) Object.defineProperty(globalThis, 'window', browserWindow);
  });
});
