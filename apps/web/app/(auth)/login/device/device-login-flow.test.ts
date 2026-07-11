import { describe, expect, it } from 'bun:test';

import {
  deviceLoginSubmitLabel,
  isDeviceLoginSubmitDisabled,
  mapAuthorizeDeviceResponse,
} from './device-login-flow';

describe('device-login-flow', () => {
  it('maps authorize responses to UI state', () => {
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
    expect(mapAuthorizeDeviceResponse({ status: 'error', message: 'Rate limited' })).toEqual({
      status: 'error',
      message: 'Rate limited',
    });
  });

  it('disables submit while loading, throttled, or session is unavailable', () => {
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
      isDeviceLoginSubmitDisabled({
        status: 'idle',
        isThrottled: true,
        isSessionChecking: false,
        isSessionReady: true,
        normalizedCodeLength: 8,
      })
    ).toBe(true);

    expect(
      isDeviceLoginSubmitDisabled({
        status: 'idle',
        isThrottled: false,
        isSessionChecking: true,
        isSessionReady: true,
        normalizedCodeLength: 8,
      })
    ).toBe(true);

    expect(
      isDeviceLoginSubmitDisabled({
        status: 'idle',
        isThrottled: false,
        isSessionChecking: false,
        isSessionReady: false,
        normalizedCodeLength: 8,
      })
    ).toBe(true);

    expect(
      isDeviceLoginSubmitDisabled({
        status: 'idle',
        isThrottled: false,
        isSessionChecking: false,
        isSessionReady: true,
        normalizedCodeLength: 7,
      })
    ).toBe(true);

    expect(
      isDeviceLoginSubmitDisabled({
        status: 'idle',
        isThrottled: false,
        isSessionChecking: false,
        isSessionReady: true,
        normalizedCodeLength: 8,
      })
    ).toBe(false);
  });

  it('returns contextual submit button labels', () => {
    expect(
      deviceLoginSubmitLabel({
        isSessionChecking: true,
        isSessionReady: false,
        status: 'idle',
      })
    ).toBe('Checking sign-in…');

    expect(
      deviceLoginSubmitLabel({
        isSessionChecking: false,
        isSessionReady: false,
        status: 'idle',
      })
    ).toBe('Sign in required');

    expect(
      deviceLoginSubmitLabel({
        isSessionChecking: false,
        isSessionReady: true,
        status: 'loading',
      })
    ).toBe('Authorizing…');

    expect(
      deviceLoginSubmitLabel({
        isSessionChecking: false,
        isSessionReady: true,
        status: 'idle',
      })
    ).toBe('Authorize terminal');

    expect(
      deviceLoginSubmitLabel({
        isSessionChecking: false,
        isSessionReady: true,
        status: 'idle',
        client: 'desktop',
      })
    ).toBe('Authorize desktop app');
  });
});
