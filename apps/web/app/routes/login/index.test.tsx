import '@testing-library/jest-dom';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../tests/setup/dom';

const redirectMock = vi.fn((options: { href: string }) => ({ redirected: true, ...options }));
const authGetSessionMock = vi.fn();
let capturedRouteConfig: any;

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (config: any) => {
    capturedRouteConfig = config;
    return config;
  }),
  redirect: redirectMock,
}));

vi.mock('../../(auth)/components/Login', () => ({
  default: () => <div>Login form</div>,
}));

vi.mock('@taskforceai/api-client/auth/auth-client', () => ({
  authClient: {
    getSession: authGetSessionMock,
  },
}));

await import('./index');

describe('login route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authGetSessionMock.mockResolvedValue(null);
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        origin: 'https://app.example.com',
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('validates supported search params and drops invalid plans', () => {
    expect(
      capturedRouteConfig.validateSearch({
        callbackUrl: '/chat',
        error: 'OAuthSignin',
        plan: 'pro',
      })
    ).toEqual({ callbackUrl: '/chat', error: 'OAuthSignin', plan: 'pro' });

    expect(
      capturedRouteConfig.validateSearch({
        callbackUrl: 42,
        error: null,
        plan: 'enterprise',
      })
    ).toEqual({ callbackUrl: undefined, error: undefined, plan: undefined });
  });

  it('does not check browser session during server-side route loading', async () => {
    const originalWindow = globalThis.window;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: undefined,
    });

    try {
      await expect(
        capturedRouteConfig.beforeLoad({ location: { search: '?callbackUrl=%2Fchat' } })
      ).resolves.toBeUndefined();
      expect(authGetSessionMock).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        writable: true,
        value: originalWindow,
      });
    }
  });

  it('redirects authenticated users to a safe callback target with plan preserved', async () => {
    authGetSessionMock.mockResolvedValue({ user: { email: 'user@example.com' } });

    await expect(
      capturedRouteConfig.beforeLoad({
        location: {
          search: '?callbackUrl=%2Fchat%3Fsource%3Dlogin&plan=super',
        },
      })
    ).rejects.toMatchObject({ redirected: true, href: '/chat?source=login&plan=super' });

    expect(redirectMock).toHaveBeenCalledWith({ href: '/chat?source=login&plan=super' });
  });

  it('does not redirect unauthenticated users and renders the login fallback surfaces', async () => {
    authGetSessionMock.mockResolvedValue(null);

    await expect(
      capturedRouteConfig.beforeLoad({ location: { search: '?callbackUrl=%2Fchat' } })
    ).resolves.toBeUndefined();
    expect(redirectMock).not.toHaveBeenCalled();

    render(capturedRouteConfig.component());
    expect(screen.getByText('Login form')).toBeInTheDocument();

    const reset = vi.fn();
    render(capturedRouteConfig.errorComponent({ reset }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(reset).toHaveBeenCalled();
  });
});
