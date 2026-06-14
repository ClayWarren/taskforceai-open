import { describe, expect, it } from 'bun:test';

import {
  deviceLoginSubmitLabel,
  isDeviceLoginSubmitDisabled,
  mapAuthorizeDeviceResponse,
  normalizeDeviceLoginCode,
  stripDeviceLoginCode,
} from './device-login';

describe('device login helpers', () => {
  it('normalizes and strips device login codes', () => {
    expect(normalizeDeviceLoginCode('abcd-1234')).toBe('ABCD-1234');
    expect(normalizeDeviceLoginCode('ab cd 12 34')).toBe('ABCD-1234');
    expect(normalizeDeviceLoginCode('ABCDEFGH1234')).toBe('ABCD-EFGH');
    expect(stripDeviceLoginCode('ab cd-1234')).toBe('ABCD1234');
  });

  it('maps authorize responses to UI state', () => {
    expect(mapAuthorizeDeviceResponse({ status: 'success' })).toMatchObject({
      status: 'success',
    });
    expect(mapAuthorizeDeviceResponse({ status: 'success' }, 'desktop')).toMatchObject({
      status: 'success',
      message: 'Approved! You can return to the desktop app.',
    });
    expect(mapAuthorizeDeviceResponse({ status: 'unauthorized' })).toMatchObject({
      status: 'error',
      sessionReady: false,
    });
    expect(mapAuthorizeDeviceResponse({ status: 'expired' })).toMatchObject({
      status: 'error',
      message: 'That code expired. Run /login in the terminal to generate a new one.',
    });
    expect(mapAuthorizeDeviceResponse({ status: 'expired' }, 'desktop')).toMatchObject({
      status: 'error',
      message: 'That code expired. Return to the desktop app and start sign in again.',
    });
    expect(mapAuthorizeDeviceResponse({ status: 'not_found' })).toMatchObject({
      status: 'error',
      message: 'Code not found. Check the terminal and re-enter.',
    });
    expect(mapAuthorizeDeviceResponse({ status: 'not_found' }, 'desktop')).toMatchObject({
      status: 'error',
      message: 'Code not found. Check the desktop app and re-enter.',
    });
    expect(mapAuthorizeDeviceResponse({ status: 'error', message: 'Custom' }).message).toBe(
      'Custom'
    );
  });

  it('resolves submit disabled state and labels', () => {
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
      deviceLoginSubmitLabel({
        status: 'idle',
        isSessionChecking: true,
        isSessionReady: true,
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
        status: 'loading',
        isSessionChecking: false,
        isSessionReady: true,
      })
    ).toBe('Authorizing…');
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
