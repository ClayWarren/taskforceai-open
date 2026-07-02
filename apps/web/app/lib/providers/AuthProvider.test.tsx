/**
 * Tests for AuthProvider component
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom';
import { act, render, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import React from 'react';

import '../../../../../tests/setup/dom';

// Mock authClient
let mockAuthToken: string | null = null;
const mockGetSession = vi.fn(async () => {
  if (mockAuthToken) {
    return {
      user: { email: 'testuser@example.com', name: 'Test User' },
      expires: new Date(Date.now() + 10000).toISOString(),
    };
  }
  return null;
});
const mockGetToken = vi.fn(async () => mockAuthToken);
const mockSignIn = vi.fn();
const mockSignOut = vi.fn();
let mockPlatformRuntime: 'browser' | 'desktop' = 'browser';
const mockStorageAdapterClearAll = vi.fn(async () => undefined);
const mockGetDesktopAppServerAuthStatus = vi.fn(
  async (): Promise<import('../platform/desktop/app-server-types').AppServerAuthStatus> => ({
    authenticated: false,
  })
);
const mockLogoutDesktopAppServerAuth = vi.fn(async () => ({
  authenticated: false,
}));
const mockGetDesktopAppServerLocalSettings = vi.fn(async () => ({
  settings: {
    memoryEnabled: true,
    webSearchEnabled: true,
    codeExecutionEnabled: true,
    trustLayerEnabled: true,
    notificationsEnabled: true,
  },
}));

vi.mock('@taskforceai/contracts/auth/auth-client', () => ({
  authClient: {
    getSession: () => mockGetSession(),
    getToken: () => mockGetToken(),
    signIn: mockSignIn,
    signOut: mockSignOut,
  },
}));

vi.mock('../platform/PlatformProvider', () => ({
  usePlatformRuntime: () => mockPlatformRuntime,
  useStorageAdapter: () => ({
    clearAll: mockStorageAdapterClearAll,
  }),
}));

vi.mock('../platform/desktop/app-server', () => ({
  getDesktopAppServerAuthStatus: () => mockGetDesktopAppServerAuthStatus(),
  getDesktopAppServerLocalSettings: () => mockGetDesktopAppServerLocalSettings(),
  logoutDesktopAppServerAuth: () => mockLogoutDesktopAppServerAuth(),
}));

import { AuthProvider, useAuth } from './AuthProvider';
import { ok } from '@taskforceai/shared/result';

// Mock the logger module
const mockLoggerError = vi.fn();
const mockLoggerWarn = vi.fn();
const mockLoggerInfo = vi.fn();

vi.mock('../logger', () => ({
  logger: {
    error: (...args: unknown[]) => mockLoggerError(...args),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    info: (...args: unknown[]) => mockLoggerInfo(...args),
    debug: vi.fn(),
    log: vi.fn(),
  },
}));

const mockLoadUserProfile = vi.fn(() => Promise.resolve(ok(mockUser)));

const mockUser = {
  email: 'test@example.com',
  full_name: 'Test User',
  plan: 'free',
  message_count: 1,
  last_message_timestamp: null,
  subscription_id: null,
  subscription_status: null,
  current_period_start: null,
  current_period_end: null,
  cancel_at_period_end: false,
  theme_preference: 'dark',
  customer_id: null,
  disabled: 'false',
  is_admin: 'false',
};

void vi.mock('@taskforceai/contracts/auth/auth-service', () => ({
  loadUserProfile: () => mockLoadUserProfile(),
  buildUserState: (u: { name?: string } | null) => u,
  extractUsername: (u: { name?: string } | null, fallback: string) => u?.name || fallback,
}));

// Mock i18n
void vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: { [key: string]: string } = {
        'auth.login': 'Login',
        'auth.logout': 'Logout',
      };
      return translations[key] || key;
    },
  }),
}));

// No local routing mock - uses global @tanstack/react-router mock from tests/bun-setup.ts

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(global, 'localStorage', {
  value: localStorageMock,
});

// Re-mock authClient for internal consistency if needed, but the top-level one should win
void vi.mock('@taskforceai/contracts/auth/auth-client', () => ({
  authClient: {
    getSession: () => mockGetSession(),
    getToken: () => mockGetToken(),
    signIn: mockSignIn,
    signOut: mockSignOut,
  },
}));

// Test component that uses the auth context
const TestConsumer: React.FC = () => {
  const { user, isAuthenticated, logout, isTokenReady } = useAuth();

  return (
    <div>
      <div data-testid="authenticated">{isAuthenticated ? 'true' : 'false'}</div>
      <div data-testid="is-token-ready">{isTokenReady ? 'true' : 'false'}</div>
      <div data-testid="user">{user ? user.email : 'null'}</div>
      <button onClick={logout}>Logout</button>
    </div>
  );
};

const ForceLogoutConsumer: React.FC = () => {
  const auth = useAuth();
  return (
    <div>
      <div data-testid="force-authenticated">{auth.isAuthenticated ? 'true' : 'false'}</div>
      <button
        data-testid="force-logout"
        onClick={() => auth.handleAuthFailure?.('test-expiry')}
        disabled={!auth.handleAuthFailure}
      >
        Force logout
      </button>
    </div>
  );
};

describe('AuthProvider', () => {
  let queryClient: QueryClient;

  const renderWithProvider = (children: React.ReactNode) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>{children}</AuthProvider>
      </QueryClientProvider>
    );
  };

  const renderTestConsumer = () => {
    renderWithProvider(<TestConsumer />);
    return within(document.body);
  };

  const renderForceLogoutConsumer = () => {
    renderWithProvider(<ForceLogoutConsumer />);
    return within(document.body);
  };

  const clickByText = async (label: string) => {
    const view = within(document.body);
    await act(async () => {
      view.getByText(label).click();
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();

    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: 0,
        },
      },
    });

    mockLoadUserProfile.mockResolvedValue(ok(mockUser));
    mockAuthToken = null;
    mockPlatformRuntime = 'browser';
    mockStorageAdapterClearAll.mockResolvedValue(undefined);
    mockGetDesktopAppServerAuthStatus.mockResolvedValue({
      authenticated: false,
    });
    mockLogoutDesktopAppServerAuth.mockResolvedValue({
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
    mockSignIn.mockResolvedValue({ ok: true });
    mockSignOut.mockResolvedValue(undefined);

    localStorage.clear();
    try {
      window.location.href = 'http://localhost/';
    } catch {
      /* noop */
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders children correctly', async () => {
    // Mock authenticated status to trigger fetchCurrentUser
    mockAuthToken = 'test-token';
    // Ensure mockLoadUserProfile is fresh
    mockLoadUserProfile.mockResolvedValue(ok(mockUser));

    const view = renderWithProvider(<TestConsumer />);

    // Wait for initial auth check to complete
    await waitFor(
      () => {
        expect(view.getByTestId('is-token-ready')).toHaveTextContent('true');
      },
      { timeout: 3000 }
    );

    await waitFor(
      () => {
        expect(mockLoadUserProfile).toHaveBeenCalled();
      },
      { timeout: 3000 }
    );

    expect(view.getByTestId('authenticated')).toHaveTextContent('true');
  });

  it('provides default auth state', async () => {
    const view = renderTestConsumer();
    await waitFor(() => {
      expect(view.getByTestId('authenticated')).toHaveTextContent('false');
      expect(view.getByTestId('user')).toHaveTextContent('null');
    });
  });

  it('uses desktop app-server auth status as the native auth source', async () => {
    mockPlatformRuntime = 'desktop';
    mockGetDesktopAppServerAuthStatus.mockResolvedValue({
      authenticated: true,
    });

    const view = renderTestConsumer();

    await waitFor(() => {
      expect(view.getByTestId('authenticated')).toHaveTextContent('true');
      expect(view.getByTestId('is-token-ready')).toHaveTextContent('true');
    });
  });

  it('falls back to unauthenticated desktop auth when app-server status cannot load', async () => {
    mockPlatformRuntime = 'desktop';
    mockGetDesktopAppServerAuthStatus.mockRejectedValue(new Error('app-server offline'));

    const view = renderTestConsumer();

    await waitFor(() => {
      expect(view.getByTestId('authenticated')).toHaveTextContent('false');
      expect(view.getByTestId('is-token-ready')).toHaveTextContent('false');
    });
  });

  it('throws error when used outside provider', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      render(<TestConsumer />);
    }).toThrow('useAuth must be used within an AuthProvider');

    consoleSpy.mockRestore();
  });

  it('handles logout', async () => {
    // Start authenticated
    mockAuthToken = 'test-token';
    mockLoadUserProfile.mockResolvedValue({
      ok: true,
      value: { ...mockUser, email: 'testuser@example.com' },
    });

    const view = renderTestConsumer();

    await waitFor(
      () => {
        expect(view.getByTestId('authenticated')).toHaveTextContent('true');
      },
      { timeout: 3000 }
    );

    // Logout triggers session clear
    mockSignOut.mockImplementation(async () => {
      mockAuthToken = null;
    });

    await clickByText('Logout');

    await waitFor(
      () => {
        expect(mockSignOut).toHaveBeenCalledWith({ redirect: false });
        expect(view.getByTestId('authenticated')).toHaveTextContent('false');
        expect(view.getByTestId('user')).toHaveTextContent('null');
      },
      { timeout: 3000 }
    );
  });

  it('falls back to unauthenticated desktop auth when app-server logout fails', async () => {
    mockPlatformRuntime = 'desktop';
    mockGetDesktopAppServerAuthStatus.mockResolvedValue({
      authenticated: true,
      user: {
        id: '42',
        email: 'desktop@example.com',
        fullName: 'Desktop User',
        image: null,
      },
    });
    mockLogoutDesktopAppServerAuth.mockRejectedValue(new Error('logout failed'));

    const view = renderTestConsumer();

    await waitFor(() => {
      expect(view.getByTestId('authenticated')).toHaveTextContent('true');
      expect(view.getByTestId('user')).toHaveTextContent('desktop@example.com');
    });

    await clickByText('Logout');

    await waitFor(() => {
      expect(mockLogoutDesktopAppServerAuth).toHaveBeenCalled();
      expect(view.getByTestId('authenticated')).toHaveTextContent('false');
      expect(view.getByTestId('is-token-ready')).toHaveTextContent('false');
    });
  });

  it('forces logout when handleAuthFailure is invoked', async () => {
    // Start authenticated
    mockAuthToken = 'test-token';
    localStorage.setItem('authToken', 'test-token');
    localStorage.setItem('taskforceai-user', JSON.stringify(mockUser));

    const view = renderForceLogoutConsumer();

    // Wait for authentication to complete
    await waitFor(() => expect(view.getByTestId('force-authenticated')).toHaveTextContent('true'));

    const afterGracePeriod = Date.now() + 11000;
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(afterGracePeriod);

    const button = view.getByTestId('force-logout');

    // Simulate session expiry
    mockSignOut.mockImplementation(async () => {
      mockAuthToken = null;
    });

    await act(async () => {
      button.click();
    });
    nowSpy.mockRestore();

    await waitFor(() =>
      expect(mockSignOut).toHaveBeenCalledWith({
        redirect: false,
      })
    );
    expect(localStorage.getItem('authToken')).toBeNull();
  });

  it('skips grace period for permanent failures (profile_not_found) (Hardening TF-0361, TF-0362)', async () => {
    // Start authenticated
    mockAuthToken = 'test-token';
    localStorage.setItem('authToken', 'test-token');
    localStorage.setItem('taskforceai-user', JSON.stringify(mockUser));

    const ForcePermanentLogoutConsumer: React.FC = () => {
      const auth = useAuth();
      return (
        <div>
          <div data-testid="force-authenticated">{auth.isAuthenticated ? 'true' : 'false'}</div>
          <button
            data-testid="force-logout-permanent"
            onClick={() => auth.handleAuthFailure?.('profile_not_found')}
            disabled={!auth.handleAuthFailure}
          >
            Force logout
          </button>
        </div>
      );
    };

    renderWithProvider(<ForcePermanentLogoutConsumer />);
    const view = within(document.body);

    // Wait for authentication to complete
    await waitFor(() => expect(view.getByTestId('force-authenticated')).toHaveTextContent('true'));

    // DO NOT advance time to bypass grace period (simulate immediate failure)
    const button = view.getByTestId('force-logout-permanent');

    mockSignOut.mockImplementation(async () => {
      mockAuthToken = null;
    });

    await act(async () => {
      button.click();
    });

    // Should immediately call signOut because it's a permanent failure, ignoring the grace period
    await waitFor(() =>
      expect(mockSignOut).toHaveBeenCalledWith({
        redirect: false,
      })
    );
    expect(localStorage.getItem('authToken')).toBeNull();
  });

  it('handles forced signout failure', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockSignOut.mockRejectedValue(new Error('Signout failed'));
    localStorage.setItem('taskforceai-user', JSON.stringify(mockUser));

    const view = renderForceLogoutConsumer();
    await waitFor(() => expect(view.getByTestId('force-logout')).toBeTruthy());

    await clickByText('Force logout');

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Forced sign-out failed'),
        expect.anything()
      );
    });

    consoleSpy.mockRestore();
  });
});
