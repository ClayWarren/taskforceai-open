import { describe, expect, it } from 'bun:test';

import {
  deviceLoginSubmitLabel,
  isDeviceLoginSubmitDisabled,
  mapAuthorizeDeviceResponse,
} from './device-login';

describe('device login presenter', () => {
  it('maps authorization outcomes to UI state', () => {
    expect(mapAuthorizeDeviceResponse({ status: 'success' })).toEqual({
      status: 'success',
      message: 'Approved! You can return to the terminal window.',
    });
    expect(mapAuthorizeDeviceResponse({ status: 'success' }, 'desktop')).toEqual({
      status: 'success',
      message: 'Approved! You can return to the desktop app.',
    });
    expect(mapAuthorizeDeviceResponse({ status: 'unauthorized' })).toEqual({
      status: 'error',
      message: 'Please sign in first, then try again.',
      sessionReady: false,
    });
    expect(mapAuthorizeDeviceResponse({ status: 'expired' })).toEqual({
      status: 'error',
      message: 'That code expired. Run /login in the terminal to generate a new one.',
    });
    expect(mapAuthorizeDeviceResponse({ status: 'expired' }, 'desktop')).toEqual({
      status: 'error',
      message: 'That code expired. Return to the desktop app and start sign in again.',
    });
    expect(mapAuthorizeDeviceResponse({ status: 'not_found' })).toEqual({
      status: 'error',
      message: 'Code not found. Check the terminal and re-enter.',
    });
    expect(mapAuthorizeDeviceResponse({ status: 'not_found' }, 'desktop')).toEqual({
      status: 'error',
      message: 'Code not found. Check the desktop app and re-enter.',
    });
    expect(mapAuthorizeDeviceResponse({ status: 'error', message: 'Try again.' })).toEqual({
      status: 'error',
      message: 'Try again.',
    });
  });

  it('derives submit state and label', () => {
    expect(
      isDeviceLoginSubmitDisabled({
        status: 'idle',
        isThrottled: false,
        isSessionChecking: false,
        isSessionReady: true,
        normalizedCodeLength: 8,
      })
    ).toBe(false);
    expect(
      deviceLoginSubmitLabel({
        status: 'loading',
        isSessionChecking: false,
        isSessionReady: true,
      })
    ).toBe('Authorizing…');
    expect(
      isDeviceLoginSubmitDisabled({
        status: 'loading',
        isThrottled: false,
        isSessionChecking: false,
        isSessionReady: true,
        normalizedCodeLength: 8,
      })
    ).toBe(true);
    expect(
      deviceLoginSubmitLabel({
        status: 'idle',
        isSessionChecking: true,
        isSessionReady: false,
      })
    ).toBe('Checking sign-in…');
    expect(
      deviceLoginSubmitLabel({
        status: 'idle',
        isSessionChecking: false,
        isSessionReady: false,
      })
    ).toBe('Sign in required');
    expect(
      deviceLoginSubmitLabel({
        status: 'idle',
        isSessionChecking: false,
        isSessionReady: true,
      })
    ).toBe('Authorize terminal');
    expect(
      deviceLoginSubmitLabel({
        status: 'idle',
        isSessionChecking: false,
        isSessionReady: true,
        client: 'desktop',
      })
    ).toBe('Authorize desktop app');
  });
});
