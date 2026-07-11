import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'bun:test';

import { err, ok } from '@taskforceai/client-core/result';
import {
  authClient,
  installAuthHarness,
  mockClearAuthToken,
  mockFetchCurrentUser,
  mockSession,
  mockStoreAuthToken,
  mockUser,
  useAuth,
} from './AuthProvider.test-harness';

describe('AuthProvider bootstrap and error recovery', () => {
  const { authStorage, profileStorage, renderAuth } = installAuthHarness();

  it('does not call the web session endpoint when a native auth override is provided', async () => {
    const view = renderAuth({
      authStorage: authStorage({
        getSession: async () => err(new Error('No session')),
        getToken: async () => err(new Error('No token')),
      }),
      profileStorage: profileStorage({
        loadProfile: async () => ok(null),
      }),
      authOverride: {
        isAuthenticated: true,
        isLoading: false,
        isTokenReady: true,
        sessionStatus: 'authenticated',
      },
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });

    expect(view.getByTestId('token-ready').textContent).toBe('ready');
    expect(authClient.getSession).not.toHaveBeenCalled();
    expect(authClient.getToken).not.toHaveBeenCalled();
    expect(mockFetchCurrentUser).not.toHaveBeenCalled();
  });

  it('uses auth override values for user, loading, token readiness, and session status', async () => {
    const view = renderAuth({
      authStorage: authStorage({
        getSession: async () => err(new Error('No session')),
        getToken: async () => err(new Error('No token')),
      }),
      profileStorage: profileStorage({
        loadProfile: async () => ok(null),
      }),
      authOverride: {
        user: { ...mockUser, email: 'override@example.com' },
        isAuthenticated: false,
        isLoading: true,
      },
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });

    expect(view.getByTestId('email').textContent).toBe('override@example.com');
    expect(view.getByTestId('authenticated').textContent).toBe('anonymous');
    expect(view.getByTestId('loading').textContent).toBe('loading');
    expect(view.getByTestId('token-ready').textContent).toBe('waiting');
    expect(view.getByTestId('session-status').textContent).toBe('loading');
    expect(authClient.getSession).not.toHaveBeenCalled();
  });

  it('derives authenticated auth override status when no explicit status is provided', async () => {
    const view = renderAuth({
      authStorage: authStorage({
        getSession: async () => err(new Error('No session')),
        getToken: async () => err(new Error('No token')),
      }),
      profileStorage: profileStorage({
        loadProfile: async () => ok(null),
      }),
      authOverride: {
        isAuthenticated: true,
      },
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });

    expect(view.getByTestId('session-status').textContent).toBe('authenticated');
    expect(view.getByTestId('token-ready').textContent).toBe('ready');
  });

  it('clears local auth state when bootstrap storage throws', async () => {
    (authClient.getSession as any).mockResolvedValue(null);
    const clearProfile = vi.fn(async () => ok(undefined));
    const view = renderAuth({
      authStorage: authStorage({
        getSession: async () => {
          throw new Error('storage offline');
        },
      }),
      profileStorage: profileStorage({
        clearProfile,
        loadProfile: async () => {
          throw new Error('profile storage offline');
        },
      }),
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });

    expect(view.getByTestId('user').textContent).toBe('logged_out');
    expect(view.getByTestId('token-ready').textContent).toBe('waiting');
    expect(mockClearAuthToken).toHaveBeenCalled();
    expect(clearProfile).not.toHaveBeenCalled();
  });

  it('reports authenticated-session token fetch failures', async () => {
    const onAuthError = vi.fn();
    (authClient.getSession as any).mockResolvedValue({
      user: { email: 'session@example.com' },
    });
    (authClient.getToken as any).mockResolvedValue(null);

    renderAuth({
      onAuthError,
      authStorage: authStorage({
        getSession: async () => err(new Error('No session')),
        getToken: async () => err(new Error('No token')),
      }),
      profileStorage: profileStorage({
        loadProfile: async () => ok(null),
      }),
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onAuthError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'token_fetch_failed' })
    );
  });

  it('fetches a bearer token when server bootstrap auth is authenticated but session polling is unauthenticated', async () => {
    (authClient.getSession as any).mockResolvedValue(null);
    (authClient.getToken as any).mockResolvedValue('bootstrap-token');

    renderAuth({
      initialAuth: {
        user: mockUser,
        isAuthenticated: true,
        sessionStatus: 'authenticated',
      },
      authStorage: authStorage({
        getSession: async () => err(new Error('No session')),
        getToken: async () => err(new Error('No token')),
      }),
      profileStorage: profileStorage({
        loadProfile: async () => ok(null),
      }),
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(authClient.getToken).toHaveBeenCalled();
    expect(mockStoreAuthToken).toHaveBeenCalledWith('bootstrap-token');
  });

  it('reports thrown token fetch errors through onAuthError', async () => {
    const onAuthError = vi.fn();
    const tokenError = new Error('token endpoint down');
    (authClient.getSession as any).mockResolvedValue({
      user: { email: 'session@example.com' },
    });
    (authClient.getToken as any).mockRejectedValue(tokenError);

    renderAuth({
      onAuthError,
      authStorage: authStorage({
        getSession: async () => err(new Error('No session')),
        getToken: async () => err(new Error('No token')),
      }),
      profileStorage: profileStorage({
        loadProfile: async () => ok(null),
      }),
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onAuthError).toHaveBeenCalledWith(tokenError);
  });

  it('clears token-backed auth state when profile validation returns a permanent error', async () => {
    (authClient.getSession as any).mockResolvedValue(null);
    mockFetchCurrentUser.mockResolvedValue({
      ok: false,
      error: { kind: 'unauthorized', message: 'Unauthorized', status: 401 },
    });
    const clearProfile = vi.fn(async () => ok(undefined));

    const view = renderAuth({
      authStorage: authStorage({
        getSession: async () => ok({ ...mockSession, accessToken: 'stored-token' }),
      }),
      profileStorage: profileStorage({
        clearProfile,
        loadProfile: async () => ok(mockUser),
      }),
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockStoreAuthToken).toHaveBeenCalledWith('stored-token');
    expect(mockClearAuthToken).toHaveBeenCalled();
    expect(clearProfile).toHaveBeenCalled();
    expect(view.getByTestId('user').textContent).toBe('logged_out');
    expect(view.getByTestId('token-ready').textContent).toBe('waiting');
  });

  it('retains token-backed auth state when profile validation fails transiently', async () => {
    (authClient.getSession as any).mockResolvedValue(null);
    const transientError = { kind: 'network', message: 'offline' };
    mockFetchCurrentUser.mockResolvedValue({
      ok: false,
      error: transientError,
    });

    const view = renderAuth({
      authStorage: authStorage({
        getSession: async () => ok({ ...mockSession, accessToken: 'stored-token' }),
      }),
      profileStorage: profileStorage({
        loadProfile: async () => ok(mockUser),
      }),
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(view.getByTestId('user').textContent).toBe('logged_in');
    expect(view.getByTestId('token-ready').textContent).toBe('ready');
    expect(mockFetchCurrentUser).toHaveBeenCalledTimes(1);
  });

  it('falls back to session identity when authenticated profile fetch fails transiently', async () => {
    (authClient.getSession as any).mockResolvedValue({
      user: { email: 'session-user@example.com', name: 'Session User' },
    });
    mockFetchCurrentUser.mockResolvedValue({
      ok: false,
      error: { kind: 'network', message: 'offline' },
    });
    const saveProfile = vi.fn(async () => ok(undefined));

    const view = renderAuth({
      profileStorage: profileStorage({
        loadProfile: async () => ok(null),
        saveProfile,
      }),
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(view.getByTestId('email').textContent).toBe('session-user@example.com');
    expect(saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'session-user@example.com',
        full_name: 'Session User',
      })
    );
  });

  it('ignores an authenticated profile response after the fetch is aborted', async () => {
    (authClient.getSession as any).mockResolvedValue({
      user: { email: 'session-user@example.com', name: 'Session User' },
    });
    let resolveProfile!: (value: unknown) => void;
    mockFetchCurrentUser.mockReturnValue(
      new Promise((resolve) => {
        resolveProfile = resolve;
      })
    );
    const saveProfile = vi.fn(async () => ok(undefined));

    const view = renderAuth({
      profileStorage: profileStorage({
        loadProfile: async () => ok(null),
        saveProfile,
      }),
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });
    view.unmount();

    await act(async () => {
      resolveProfile(ok({ ...mockUser, email: 'late@example.com' }));
      await Promise.resolve();
    });

    expect(saveProfile).not.toHaveBeenCalledWith(
      expect.objectContaining({ email: 'late@example.com' })
    );
  });

  it('forces logout when authenticated profile fetch returns a permanent error', async () => {
    (authClient.getSession as any).mockResolvedValue({
      user: { email: 'session-user@example.com', name: 'Session User' },
    });
    mockFetchCurrentUser.mockResolvedValue({
      ok: false,
      error: { kind: 'not_found', message: 'Missing profile', status: 404 },
    });

    renderAuth({
      profileStorage: profileStorage({
        loadProfile: async () => ok(null),
      }),
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(authClient.signOut).toHaveBeenCalledWith({ redirect: false });
  });

  it('does not repeat forced auth failure cleanup while a failure is already being handled', async () => {
    let releaseLogout!: () => void;
    const onLogout = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseLogout = resolve;
        })
    );
    const view = renderAuth({ onLogout });

    await act(async () => {
      vi.advanceTimersByTime(11_000);
      view.getByTestId('force-fail-transient').click();
      view.getByTestId('force-fail-transient').click();
      await Promise.resolve();
    });

    expect(onLogout).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseLogout();
      await Promise.resolve();
    });
  });

  it('continues forced auth failure cleanup when logout hooks and signout fail', async () => {
    const logoutError = new Error('logout hook failed');
    const signOutError = new Error('signout failed');
    const onAuthError = vi.fn();
    (authClient.signOut as any).mockRejectedValueOnce(signOutError);
    const view = renderAuth({
      onAuthError,
      onLogout: vi.fn(async () => {
        throw logoutError;
      }),
    });

    await act(async () => {
      vi.advanceTimersByTime(11_000);
      view.getByTestId('force-fail-transient').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(authClient.signOut).toHaveBeenCalledWith({ redirect: false });
    expect(onAuthError).toHaveBeenCalledWith(expect.objectContaining({ message: 'network_error' }));
  });

  it('throws when useAuth is rendered outside AuthProvider', () => {
    const BrokenConsumer = () => {
      useAuth();
      return null;
    };

    expect(() => render(<BrokenConsumer />)).toThrow('useAuth must be used within an AuthProvider');
  });
});
