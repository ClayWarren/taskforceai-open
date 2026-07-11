import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import '../../../../../../tests/setup/dom';

import type { AuthProviderConfig } from '@taskforceai/react-core/auth/AuthProvider';
import type { AuthenticatedUser } from '@taskforceai/contracts/contracts';

let capturedConfig: AuthProviderConfig | null = null;

const mockLogoutUser = vi.fn();
const mockLoadStoredUser = vi.fn();
const mockStoreUser = vi.fn();
const mockClearStoredUser = vi.fn();
const mockLoggerError = vi.fn();
const mockLoggerWarn = vi.fn();

vi.mock('@taskforceai/api-client/api/account', () => ({
  logoutUser: (...args: unknown[]) => mockLogoutUser(...args),
}));

vi.mock('@taskforceai/react-core/auth/AuthProvider', () => ({
  AuthProvider: ({
    children,
    config,
  }: {
    children: React.ReactNode;
    config: AuthProviderConfig;
  }) => {
    capturedConfig = config;
    return <div data-testid="shared-provider">{children}</div>;
  },
  useAuth: vi.fn(() => ({
    user: null,
    isAuthenticated: false,
    isLoading: false,
    isTokenReady: false,
    sessionStatus: 'unauthenticated',
    logout: async () => {},
    refreshUser: async () => {},
    handleAuthFailure: async () => {},
  })),
}));

vi.mock('@taskforceai/api-client/auth/auth-storage', () => ({
  clearStoredUser: () => mockClearStoredUser(),
  loadStoredUser: () => mockLoadStoredUser(),
  storeUser: (user: unknown) => mockStoreUser(user),
}));

vi.mock('@taskforceai/api-client/auth/logger', () => ({
  getAuthLogger: () => ({
    error: mockLoggerError,
    warn: mockLoggerWarn,
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { AuthProvider, useAuth } from './AuthProvider';

const storedUser: AuthenticatedUser = {
  id: 1,
  email: 'cached@example.com',
  full_name: null,
  plan: 'free',
  message_count: 0,
  free_tasks_remaining: 0,
  last_message_timestamp: null,
  subscription_id: null,
  subscription_status: null,
  subscription_source: null,
  current_period_start: null,
  current_period_end: null,
  cancel_at_period_end: false,
  theme_preference: 'light',
  memory_enabled: true,
  web_search_enabled: true,
  code_execution_enabled: true,
  mfa_enabled: false,
  notifications_enabled: true,
  quick_mode_enabled: false,
  trust_layer_enabled: false,
  customer_id: null,
  disabled: 'false',
  is_admin: false,
  trial_ends_at: null,
};

describe('ui-kit AuthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedConfig = null;
    mockLoadStoredUser.mockReturnValue({ ok: true, value: storedUser });
    mockStoreUser.mockReturnValue({ ok: true, value: true });
    mockClearStoredUser.mockImplementation(() => undefined);
  });

  it('configures the shared auth provider with browser storage adapters', async () => {
    render(
      <AuthProvider>
        <span>inside</span>
      </AuthProvider>
    );

    expect(screen.getByTestId('shared-provider')).toHaveTextContent('inside');
    expect(capturedConfig?.authStorage.getSession).toBeTypeOf('function');
    expect(await capturedConfig?.profileStorage.loadProfile()).toEqual({
      ok: true,
      value: storedUser,
    });
  });

  it('persists and clears profiles through the browser storage helpers', async () => {
    render(<AuthProvider>inside</AuthProvider>);
    const profileStorage = capturedConfig?.profileStorage;
    if (!profileStorage) throw new Error('Expected shared provider config');

    await profileStorage.saveProfile(storedUser);
    expect(mockStoreUser).toHaveBeenCalledWith(storedUser);

    await profileStorage.clearProfile();
    expect(mockClearStoredUser).toHaveBeenCalled();
  });

  it('maps profile storage failures to errors for the shared auth provider', async () => {
    render(<AuthProvider>inside</AuthProvider>);
    const profileStorage = capturedConfig?.profileStorage;
    if (!profileStorage) throw new Error('Expected shared provider config');

    mockLoadStoredUser.mockReturnValue({ ok: false, error: 'corrupt stored profile' });
    await expect(profileStorage.loadProfile()).resolves.toEqual({ ok: true, value: null });

    mockStoreUser.mockReturnValue({ ok: false, error: 'quota exceeded' });
    const saveResult = await profileStorage.saveProfile(storedUser);
    expect(saveResult.ok).toBe(false);
    if (!saveResult.ok) {
      expect(saveResult.error.message).toBe('quota exceeded');
    }

    mockClearStoredUser.mockImplementation(() => {
      throw new Error('clear failed');
    });
    const clearResult = await profileStorage.clearProfile();
    expect(clearResult.ok).toBe(false);
    if (!clearResult.ok) {
      expect(clearResult.error.message).toBe('clear failed');
    }
  });

  it('ignores incomplete stored profiles instead of hydrating partial users', async () => {
    render(<AuthProvider>inside</AuthProvider>);
    const profileStorage = capturedConfig?.profileStorage;
    if (!profileStorage) throw new Error('Expected shared provider config');

    mockLoadStoredUser.mockReturnValue({ ok: true, value: { email: 'cached@example.com' } });

    await expect(profileStorage.loadProfile()).resolves.toEqual({ ok: true, value: null });
  });

  it('passes the account logout handler through to the shared provider', async () => {
    render(<AuthProvider>inside</AuthProvider>);

    await capturedConfig?.onLogout?.();
    expect(mockLogoutUser).toHaveBeenCalled();
  });

  it('re-exports useAuth from the shared provider', () => {
    expect(useAuth()).toMatchObject({ user: null, isAuthenticated: false });
  });
});
