import { describe, expect, it } from 'bun:test';

import {
  buildLoginCallbackUrl,
  getLoginErrorMessage,
  parseLoginQuery,
  resolveLoginRedirectTarget,
} from './login-redirect';

const ORIGIN = 'http://localhost';

describe('login-redirect helpers', () => {
  it('parses valid plan values only', () => {
    const parsed = parseLoginQuery(
      new URLSearchParams('plan=pro&callbackUrl=%2Fchat&error=OAuthSignin')
    );
    expect(parsed).toEqual({
      callbackUrl: '/chat',
      error: 'OAuthSignin',
      plan: 'pro',
    });

    const invalidPlan = parseLoginQuery(new URLSearchParams('plan=enterprise'));
    expect(invalidPlan.plan).toBeNull();
  });

  it('builds callback URL from internal callback and plan', () => {
    const callbackUrl = buildLoginCallbackUrl(
      {
        callbackUrl: '/chat?source=login',
        error: null,
        plan: 'super',
      },
      ORIGIN
    );

    expect(callbackUrl).toBe('/chat?source=login&plan=super');
  });

  it('rejects external callback URLs during sign-in callback build', () => {
    const callbackUrl = buildLoginCallbackUrl(
      {
        callbackUrl: 'https://example.com/malicious',
        error: null,
        plan: 'pro',
      },
      ORIGIN
    );

    expect(callbackUrl).toBeUndefined();
  });

  it('falls back to plan or home for authenticated redirects', () => {
    const redirectWithInvalidCallback = resolveLoginRedirectTarget(
      {
        callbackUrl: 'https://example.com/redirect',
        error: null,
        plan: 'pro',
      },
      ORIGIN
    );
    expect(redirectWithInvalidCallback).toBe('/?plan=pro');

    const redirectWithoutPlan = resolveLoginRedirectTarget(
      {
        callbackUrl: null,
        error: null,
        plan: null,
      },
      ORIGIN
    );
    expect(redirectWithoutPlan).toBe('/');
  });

  it('builds callback URL from plan when no callback is provided', () => {
    const callbackUrl = buildLoginCallbackUrl(
      {
        callbackUrl: null,
        error: null,
        plan: 'super',
      },
      ORIGIN
    );

    expect(callbackUrl).toBe('/?plan=super');
  });

  it('returns safe internal callback without a plan', () => {
    const callbackUrl = buildLoginCallbackUrl(
      {
        callbackUrl: '/settings',
        error: null,
        plan: null,
      },
      ORIGIN
    );

    expect(callbackUrl).toBe('/settings');
  });

  it('preserves hash fragments in callback URLs', () => {
    const callbackUrl = buildLoginCallbackUrl(
      {
        callbackUrl: '/settings#billing',
        error: null,
        plan: 'pro',
      },
      ORIGIN
    );

    expect(callbackUrl).toBe('/settings?plan=pro#billing');
  });

  it('rejects malformed callback URLs during sign-in callback build', () => {
    const callbackUrl = buildLoginCallbackUrl(
      {
        callbackUrl: 'http://[::1',
        error: null,
        plan: null,
      },
      ORIGIN
    );

    expect(callbackUrl).toBeUndefined();
  });

  it('resolves authenticated redirect with safe callback and plan', () => {
    const redirectTarget = resolveLoginRedirectTarget(
      {
        callbackUrl: '/chat?tab=recent',
        error: null,
        plan: 'pro',
      },
      ORIGIN
    );

    expect(redirectTarget).toBe('/chat?tab=recent&plan=pro');
  });

  it('maps login error codes to user-facing messages', () => {
    expect(getLoginErrorMessage('CredentialsSignin')).toBe('Invalid username or password');
    expect(getLoginErrorMessage('OAuthSignin')).toBe('OAuth sign-in failed. Please try again.');
    expect(getLoginErrorMessage('OAuthCallback')).toBe('OAuth callback error. Please try again.');
    expect(getLoginErrorMessage('OAuthAccountNotLinked')).toBe(
      'This email is already associated with another login method. Please sign in using your original method.'
    );
    expect(getLoginErrorMessage('ConfigurationError')).toBe(
      'Access denied or service configuration error. Please ensure you have permission to access this application.'
    );
    expect(getLoginErrorMessage('AccessDenied')).toBe(
      'Access denied or service configuration error. Please ensure you have permission to access this application.'
    );
    expect(getLoginErrorMessage('sessionExpired')).toBe(
      'Your session has expired. Please sign in again to continue.'
    );
    expect(getLoginErrorMessage('UnknownError')).toBe(
      'Authentication error (UnknownError). Please try again.'
    );
    expect(getLoginErrorMessage(null)).toBe('');
  });
});
