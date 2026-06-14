import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import React from 'react';

import '../../../../../tests/setup/dom';

type WebAuthConfig = {
  authStorage: unknown;
  profileStorage: {
    loadProfile: () => Promise<{ ok: boolean; value?: unknown; error?: Error }>;
    saveProfile: (user: unknown) => Promise<{ ok: boolean; error?: Error }>;
    clearProfile: () => Promise<{ ok: boolean; error?: Error }>;
  };
  onLogout?: () => Promise<void>;
  authOverride?: {
    user: { email?: string | null } | null;
    isAuthenticated: boolean;
    isLoading?: boolean;
    isTokenReady?: boolean;
    sessionStatus?: string;
  } | null;
};

let capturedConfig: WebAuthConfig | null = null;
let mockPlatformRuntime: 'browser' | 'desktop' = 'browser';
type MockDesktopAuthStatus = {
  authenticated: boolean;
  user?: { id?: string; email?: string | null };
};
const mockGetDesktopAppServerAuthStatus = vi.fn(
  async (): Promise<MockDesktopAuthStatus> => ({
    authenticated: false,
  })
);
const mockGetDesktopAppServerLocalSettings = vi.fn(async () => ({
  settings: {
    memoryEnabled: true,
    webSearchEnabled: true,
    codeExecutionEnabled: true,
    trustLayerEnabled: true,
    notificationsEnabled: true,
  },
}));
const mockLogoutDesktopAppServerAuth = vi.fn(async () => ({
  authenticated: false,
}));

vi.mock('@taskforceai/contracts/auth/AuthProvider', () => ({
  AuthProvider: ({ children, config }: { children: React.ReactNode; config: WebAuthConfig }) => {
    capturedConfig = config;
    return <div data-testid="shared-auth-provider">{children}</div>;
  },
  useAuth: () => ({
    user: null,
    isAuthenticated: false,
    logout: vi.fn(),
    isTokenReady: true,
  }),
}));

const mockLoadStoredUser = vi.fn();
const mockStoreUser = vi.fn();
const mockClearStoredUser = vi.fn();

vi.mock('@taskforceai/contracts/auth/auth-storage', () => ({
  loadStoredUser: () => mockLoadStoredUser(),
  storeUser: (user: unknown) => mockStoreUser(user),
  clearStoredUser: () => mockClearStoredUser(),
}));

vi.mock('../platform/PlatformProvider', () => ({
  usePlatformRuntime: () => mockPlatformRuntime,
}));

vi.mock('../platform/desktop/app-server', () => ({
  getDesktopAppServerAuthStatus: () => mockGetDesktopAppServerAuthStatus(),
  getDesktopAppServerLocalSettings: () => mockGetDesktopAppServerLocalSettings(),
  logoutDesktopAppServerAuth: () => mockLogoutDesktopAppServerAuth(),
}));

vi.mock('@taskforceai/contracts/auth/logger', () => ({
  getAuthLogger: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('AuthProvider web profile storage', () => {
  beforeEach(() => {
    capturedConfig = null;
    mockLoadStoredUser.mockReset();
    mockStoreUser.mockReset();
    mockClearStoredUser.mockReset();
    mockPlatformRuntime = 'browser';
    mockGetDesktopAppServerAuthStatus.mockResolvedValue({
      authenticated: false,
    });
    mockGetDesktopAppServerLocalSettings.mockResolvedValue({
      settings: {
        memoryEnabled: true,
        webSearchEnabled: true,
        codeExecutionEnabled: true,
        trustLayerEnabled: true,
        notificationsEnabled: true,
      },
    });
    mockLogoutDesktopAppServerAuth.mockResolvedValue({
      authenticated: false,
    });
    localStorage.clear();
  });

  it('wires web profile storage into the shared auth provider', async () => {
    const { AuthProvider } = await import('./AuthProvider');

    render(
      <AuthProvider>
        <div>child</div>
      </AuthProvider>
    );

    expect(capturedConfig).not.toBeNull();
    expect(capturedConfig?.profileStorage).toBeDefined();
  });

  it('loads stored profiles and tolerates storage read failures', async () => {
    const { AuthProvider } = await import('./AuthProvider');
    render(
      <AuthProvider>
        <div>child</div>
      </AuthProvider>
    );

    const profileStorage = capturedConfig?.profileStorage;
    if (!profileStorage) {
      throw new Error('Expected profile storage config');
    }

    mockLoadStoredUser.mockReturnValueOnce({
      ok: true,
      value: { email: 'user@example.com' },
    });
    await expect(profileStorage.loadProfile()).resolves.toEqual({
      ok: true,
      value: { email: 'user@example.com' },
    });

    mockLoadStoredUser.mockReturnValueOnce({
      ok: false,
      error: new Error('missing profile'),
    });
    await expect(profileStorage.loadProfile()).resolves.toEqual({
      ok: true,
      value: null,
    });
  });

  it('persists and clears profiles with error handling', async () => {
    const { AuthProvider } = await import('./AuthProvider');
    render(
      <AuthProvider>
        <div>child</div>
      </AuthProvider>
    );

    const profileStorage = capturedConfig?.profileStorage;
    if (!profileStorage) {
      throw new Error('Expected profile storage config');
    }

    mockStoreUser.mockImplementationOnce(() => undefined);
    await expect(profileStorage.saveProfile({ email: 'user@example.com' })).resolves.toEqual({
      ok: true,
    });

    mockStoreUser.mockImplementationOnce(() => {
      throw new Error('write failed');
    });
    const saveResult = await profileStorage.saveProfile({ email: 'user@example.com' });
    expect(saveResult.ok).toBe(false);
    if (!saveResult.ok) {
      expect(saveResult.error?.message).toBe('write failed');
    }

    mockClearStoredUser.mockImplementationOnce(() => undefined);
    await expect(profileStorage.clearProfile()).resolves.toEqual({
      ok: true,
    });

    mockClearStoredUser.mockImplementationOnce(() => {
      throw 'clear failed';
    });
    const clearResult = await profileStorage.clearProfile();
    expect(clearResult.ok).toBe(false);
    if (!clearResult.ok) {
      expect(clearResult.error?.message).toBe('clear failed');
    }
  });

  it('does not authenticate desktop from a stored user while native auth is unresolved', async () => {
    mockPlatformRuntime = 'desktop';
    mockGetDesktopAppServerAuthStatus.mockImplementation(() => new Promise(() => {}));
    mockGetDesktopAppServerLocalSettings.mockImplementation(() => new Promise(() => {}));
    mockLoadStoredUser.mockReturnValue({
      ok: true,
      value: {
        id: 123,
        email: 'cached@example.com',
        full_name: 'Cached User',
        plan: 'super',
      },
    });

    const { AuthProvider } = await import('./AuthProvider');

    render(
      <AuthProvider>
        <div>child</div>
      </AuthProvider>
    );

    expect(capturedConfig?.authOverride).toMatchObject({
      user: null,
      isAuthenticated: false,
      isLoading: true,
      isTokenReady: false,
      sessionStatus: 'loading',
    });
  });

  it('keeps desktop auth loading when there is no stored user hint', async () => {
    mockPlatformRuntime = 'desktop';
    mockGetDesktopAppServerAuthStatus.mockImplementation(() => new Promise(() => {}));
    mockGetDesktopAppServerLocalSettings.mockImplementation(() => new Promise(() => {}));
    mockLoadStoredUser.mockReturnValue({
      ok: false,
      error: 'NOT_FOUND',
    });

    const { AuthProvider } = await import('./AuthProvider');

    render(
      <AuthProvider>
        <div>child</div>
      </AuthProvider>
    );

    expect(capturedConfig?.authOverride).toMatchObject({
      user: null,
      isAuthenticated: false,
      isLoading: true,
      isTokenReady: false,
      sessionStatus: 'loading',
    });
  });

  it('logs out desktop app-server auth from the shared logout hook', async () => {
    mockPlatformRuntime = 'desktop';
    mockGetDesktopAppServerAuthStatus.mockResolvedValue({
      authenticated: true,
      user: { id: '1', email: 'desktop@example.com' },
    });

    const { AuthProvider } = await import('./AuthProvider');

    render(
      <AuthProvider>
        <div>child</div>
      </AuthProvider>
    );

    expect(capturedConfig?.onLogout).toBeDefined();
    await capturedConfig?.onLogout?.();

    expect(mockLogoutDesktopAppServerAuth).toHaveBeenCalledTimes(1);
  });
});
