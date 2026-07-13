import { act } from '@testing-library/react';
import { describe, expect, it, vi } from 'bun:test';

import type { AuthenticatedUser } from '@taskforceai/api-client/auth/types';
import { err, ok } from '@taskforceai/client-core/result';
import {
  advance,
  advanceAndFlush,
  authClient,
  installAuthHarness,
  mockClearAuthToken,
  mockFetchCurrentUser,
  mockSession,
  mockStoreAuthToken,
  mockUser,
} from './AuthProvider.test-harness';

describe('AuthProvider', () => {
  const { authStorage, profileStorage, renderAuth } = installAuthHarness();

  it('skips grace period for permanent failures (profile_not_found) (Hardening TF-0361, TF-0362)', async () => {
    const view = renderAuth();

    // Initial state
    expect(view.getByTestId('user').textContent).toBe('logged_out');

    // Simulate authentication success internally
    await advance(100);

    // Trigger a permanent failure
    await act(async () => {
      view.getByTestId('force-fail-permanent').click();
    });

    // SignOut should be called IMMEDIATELY without advancing the 10-second grace period timer
    expect(authClient.signOut).toHaveBeenCalled();
  });

  it('respects grace period for transient failures', async () => {
    const view = renderAuth();

    await advance(100);

    // Advance 5 seconds (inside 10s grace period)
    await act(async () => {
      vi.advanceTimersByTime(5000);
      view.getByTestId('force-fail-transient').click();
    });
    expect(authClient.signOut).not.toHaveBeenCalled();

    // Advance past grace period (another 6 seconds, total 11s)
    await act(async () => {
      vi.advanceTimersByTime(6000);
      view.getByTestId('force-fail-transient').click();
    });
    expect(authClient.signOut).toHaveBeenCalled();
  });

  it('waits for the token to be ready before fetching the user profile', async () => {
    // 1. Mock session to be authenticated
    (authClient.getSession as any).mockResolvedValue({ user: { email: 'test@example.com' } });

    // 2. Mock getToken to be delayed
    let resolveToken: (value: string | null) => void;
    const tokenPromise = new Promise<string | null>((resolve) => {
      resolveToken = resolve;
    });
    (authClient.getToken as any).mockReturnValue(tokenPromise);

    // 3. Mock loadUserProfile
    mockFetchCurrentUser.mockResolvedValue(ok({ email: 'test@example.com' }));

    renderAuth(
      {
        authStorage: authStorage({
          getSession: async () => err(new Error('No session')),
          getToken: async () => err(new Error('No token')),
        }),
        profileStorage: profileStorage({
          loadProfile: async () => ok(null),
        }),
      },
      <div>Test</div>
    );

    // Advance timers to trigger session load
    await advance(100);

    // At this point, session is 'authenticated', but getToken is still pending.
    // loadUserProfile should NOT have been called yet because hasValidStoredToken is false.
    expect(mockFetchCurrentUser).not.toHaveBeenCalled();

    // Now resolve the token
    await act(async () => {
      resolveToken!('fake-token');
      // Wait for the token-fetching promise and subsequent state updates
      await Promise.resolve();
      vi.advanceTimersByTime(100);
    });

    // Now loadUserProfile should have been called
    expect(mockFetchCurrentUser).toHaveBeenCalled();
  });

  it('keeps the updated local user when saveProfile fails during session sync', async () => {
    (authClient.getSession as any).mockResolvedValue({
      user: { email: 'updated@example.com', name: 'Updated User' },
    });
    (authClient.getToken as any).mockResolvedValue('token');
    mockFetchCurrentUser.mockResolvedValue(ok({ email: 'updated@example.com' }));
    const saveProfile = vi.fn(async () => err(new Error('storage failed')));

    const view = renderAuth({
      profileStorage: profileStorage({ saveProfile }),
    });

    await advanceAndFlush(100);

    expect(view.getByTestId('email').textContent).toBe('updated@example.com');
    expect(saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'updated@example.com',
        full_name: 'Updated User',
      })
    );
  });

  it('retains the cached profile when authenticated profile refresh has a transient failure', async () => {
    const cachedUser: AuthenticatedUser = {
      ...mockUser,
      plan: 'pro',
      free_tasks_remaining: 99,
      subscription_status: 'active',
    };
    const saveProfile = vi.fn(async () => ok(undefined));
    mockFetchCurrentUser.mockResolvedValue(
      err({ kind: 'network', message: 'Failed to load current user profile' })
    );

    const view = renderAuth({
      profileStorage: profileStorage({
        loadProfile: async () => ok(cachedUser),
        saveProfile,
      }),
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(view.getByTestId('email').textContent).toBe('test@example.com');
    expect(saveProfile).not.toHaveBeenCalledWith(
      expect.objectContaining({
        id: 0,
        plan: 'free',
      })
    );
  });

  it('logs out and clears local auth state', async () => {
    const calls: string[] = [];
    const clearSession = vi.fn(async () => {
      calls.push('clearSession');
      return ok(undefined);
    });
    const clearProfile = vi.fn(async () => ok(undefined));
    const onLogout = vi.fn(() => {
      calls.push('onLogout');
    });
    const view = renderAuth({
      authStorage: authStorage({ clearSession }),
      profileStorage: profileStorage({ clearProfile }),
      onLogout,
    });

    await advanceAndFlush(100);

    await act(async () => {
      view.getByTestId('logout').click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(authClient.signOut).toHaveBeenCalledWith({ redirect: false });
    expect(clearSession).toHaveBeenCalled();
    expect(clearProfile).toHaveBeenCalled();
    expect(onLogout).toHaveBeenCalled();
    expect(calls).toEqual(['onLogout', 'clearSession']);
  });

  it('continues logout cleanup when the logout side effect fails', async () => {
    const clearSession = vi.fn(async () => ok(undefined));
    const clearProfile = vi.fn(async () => ok(undefined));
    const logoutError = new Error('native logout failed');
    const view = renderAuth({
      authStorage: authStorage({ clearSession }),
      profileStorage: profileStorage({ clearProfile }),
      onLogout: vi.fn(async () => {
        throw logoutError;
      }),
    });

    await advanceAndFlush(100);

    await act(async () => {
      view.getByTestId('logout').click();
      await Promise.resolve();
    });

    expect(authClient.signOut).toHaveBeenCalledWith({ redirect: false });
    expect(clearSession).toHaveBeenCalled();
    expect(clearProfile).toHaveBeenCalled();
  });

  it('continues logout cleanup when sign out and storage clearing fail', async () => {
    const clearSession = vi.fn(async () => {
      throw new Error('storage clear failed');
    });
    const clearProfile = vi.fn(async () => ok(undefined));
    (authClient.signOut as any).mockRejectedValueOnce(new Error('sign out failed'));

    const view = renderAuth({
      authStorage: authStorage({ clearSession }),
      profileStorage: profileStorage({ clearProfile }),
    });

    await advanceAndFlush(100);

    await act(async () => {
      view.getByTestId('logout').click();
      await Promise.resolve();
    });

    expect(clearSession).toHaveBeenCalled();
    expect(clearProfile).not.toHaveBeenCalled();
    expect(mockClearAuthToken).toHaveBeenCalled();
  });

  it('continues forced auth failure cleanup when local storage clearing fails', async () => {
    const clearError = new Error('storage clear failed');
    const onAuthError = vi.fn();
    const view = renderAuth({
      onAuthError,
      authStorage: authStorage({
        clearSession: async () => {
          throw clearError;
        },
      }),
    });

    await act(async () => {
      vi.advanceTimersByTime(11_000);
      view.getByTestId('force-fail-transient').click();
      await Promise.resolve();
    });

    expect(mockClearAuthToken).toHaveBeenCalled();
    expect(authClient.signOut).toHaveBeenCalledWith({ redirect: false });
    expect(onAuthError).toHaveBeenCalledWith(expect.objectContaining({ message: 'network_error' }));
  });

  it('force refresh loads session and profile from storage', async () => {
    const refreshedUser = { ...mockUser, email: 'refreshed@example.com' };
    const loadProfile = vi.fn(async () => ok(refreshedUser));
    const getSession = vi
      .fn()
      .mockResolvedValueOnce(ok({ ...mockSession, accessToken: 'old-token' }))
      .mockResolvedValue(ok({ ...mockSession, accessToken: 'fresh-token' }));
    const view = renderAuth({
      authStorage: authStorage({
        getSession,
        getToken: async () => ok('old-token'),
      }),
      profileStorage: profileStorage({ loadProfile }),
    });

    await advanceAndFlush(100);

    await act(async () => {
      view.getByTestId('refresh').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getSession).toHaveBeenCalled();
    expect(loadProfile).toHaveBeenCalled();
    expect(mockStoreAuthToken).toHaveBeenCalledWith('fresh-token');
    expect(view.getByTestId('token-ready').textContent).toBe('ready');
  });

  it('clears a cached profile when no stored session exists', async () => {
    (authClient.getSession as any).mockResolvedValue(null);
    (authClient.getToken as any).mockResolvedValue(null);
    const clearProfile = vi.fn(async () => ok(undefined));
    const view = renderAuth({
      authStorage: authStorage({
        getSession: async () => err(new Error('No session')),
        getToken: async () => err(new Error('No token')),
      }),
      profileStorage: profileStorage({
        loadProfile: async () => ok({ ...mockUser, email: 'stale@example.com' }),
        clearProfile,
      }),
    });

    await advanceAndFlush(100);

    expect(view.getByTestId('user').textContent).toBe('logged_out');
    expect(view.getByTestId('email').textContent).toBe('');
    expect(view.getByTestId('token-ready').textContent).toBe('waiting');
    expect(clearProfile).toHaveBeenCalled();
    expect(mockClearAuthToken).toHaveBeenCalled();
  });

  it('can render a cached profile before a cookie session resolves when explicitly enabled', async () => {
    (authClient.getSession as any).mockReturnValue(new Promise(() => {}));
    const clearProfile = vi.fn(async () => ok(undefined));

    const view = renderAuth({
      allowProfileBootstrapWithoutSession: true,
      authStorage: authStorage({
        getSession: async () => err(new Error('No session')),
        getToken: async () => err(new Error('No token')),
      }),
      profileStorage: profileStorage({
        loadProfile: async () => ok({ ...mockUser, email: 'cached@example.com' }),
        clearProfile,
      }),
    });

    await advanceAndFlush(100);

    expect(view.getByTestId('email').textContent).toBe('cached@example.com');
    expect(view.getByTestId('authenticated').textContent).toBe('anonymous');
    expect(view.getByTestId('token-ready').textContent).toBe('waiting');
    expect(clearProfile).not.toHaveBeenCalled();
  });

  it('uses initial auth while the browser session is still loading', async () => {
    (authClient.getSession as any).mockReturnValue(new Promise(() => {}));
    const clearProfile = vi.fn(async () => ok(undefined));
    const saveProfile = vi.fn(async () => ok(undefined));

    const view = renderAuth({
      initialAuth: {
        user: { ...mockUser, email: 'server@example.com' },
        isAuthenticated: true,
        sessionStatus: 'authenticated',
      },
      authStorage: authStorage({
        getSession: async () => err(new Error('No session')),
        getToken: async () => err(new Error('No token')),
      }),
      profileStorage: profileStorage({
        loadProfile: async () => ok(null),
        saveProfile,
        clearProfile,
      }),
    });

    expect(view.getByTestId('email').textContent).toBe('server@example.com');
    expect(view.getByTestId('authenticated').textContent).toBe('authenticated');
    expect(view.getByTestId('loading').textContent).toBe('ready');
    expect(view.getByTestId('token-ready').textContent).toBe('waiting');
    expect(view.getByTestId('session-status').textContent).toBe('authenticated');
    expect(clearProfile).not.toHaveBeenCalled();

    await advanceAndFlush(100);

    expect(saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'server@example.com' })
    );
  });

  it('logs bootstrap profile persistence failures for initial auth', async () => {
    (authClient.getSession as any).mockReturnValue(new Promise(() => {}));
    const storageError = new Error('profile save failed');
    const saveProfile = vi.fn(async () => err(storageError));

    renderAuth({
      initialAuth: {
        user: { ...mockUser, email: 'server@example.com' },
        isAuthenticated: true,
      },
      authStorage: authStorage({
        getSession: async () => err(new Error('No session')),
        getToken: async () => err(new Error('No token')),
      }),
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

    expect(saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'server@example.com' })
    );
  });

  it('clears a profile bootstrap once unauthenticated session polling settles without a token', async () => {
    (authClient.getSession as any).mockResolvedValue(null);
    (authClient.getToken as any).mockResolvedValue(null);
    mockFetchCurrentUser.mockResolvedValue({
      ok: false,
      error: { kind: 'unauthorized', message: 'Unauthorized', status: 401 },
    });
    const clearProfile = vi.fn(async () => ok(undefined));

    const view = renderAuth({
      allowProfileBootstrapWithoutSession: true,
      authStorage: authStorage({
        getSession: async () => err(new Error('No session')),
        getToken: async () => err(new Error('No token')),
      }),
      profileStorage: profileStorage({
        loadProfile: async () => ok({ ...mockUser, email: 'cached@example.com' }),
        clearProfile,
      }),
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(view.getByTestId('user').textContent).toBe('logged_out');
    expect(clearProfile).toHaveBeenCalled();
    expect(mockClearAuthToken).toHaveBeenCalled();
  });

  it('validates a token-only unauthenticated session once per token', async () => {
    (authClient.getSession as any).mockResolvedValue(null);
    mockFetchCurrentUser.mockResolvedValue(ok({ email: 'token@example.com' }));

    const view = renderAuth({
      authStorage: authStorage({
        getSession: async () =>
          ok({
            ...mockSession,
            accessToken: 'stored-token',
          }),
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

    expect(view.getByTestId('email').textContent).toBe('token@example.com');
    expect(mockFetchCurrentUser).toHaveBeenCalledTimes(1);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockFetchCurrentUser).toHaveBeenCalledTimes(1);
  });
});
