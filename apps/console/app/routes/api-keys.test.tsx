import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import type { ComponentType } from 'react';

import '../../../../tests/setup/dom';

import type { UsageStats } from '../lib/developer/developer-dashboard';
import { err, ok } from '@taskforceai/client-core/result';

const mockGetSignInUrl = vi.fn();
const mockUseAuth = vi.fn();
const mockUseDeveloperUsageStats = vi.fn();
const mockRefreshUsageStats = vi.fn();
const mockCreateDeveloperApiKey = vi.fn();
const mockRevokeDeveloperApiKey = vi.fn();
const mockWriteClipboardText = vi.fn();
const mockConfirmAction = vi.fn();
const mockShowAlert = vi.fn();

vi.mock('@taskforceai/api-client/auth/auth-client', () => ({
  authClient: {
    getSignInUrl: mockGetSignInUrl,
  },
}));

vi.mock('@taskforceai/ui-kit/auth/AuthProvider', () => ({
  useAuth: mockUseAuth,
}));

vi.mock('../lib/developer/developer-dashboard', () => ({
  createDeveloperApiKey: mockCreateDeveloperApiKey,
  revokeDeveloperApiKey: mockRevokeDeveloperApiKey,
}));

vi.mock('../lib/developer/useDeveloperUsageStats', () => ({
  useDeveloperUsageStats: mockUseDeveloperUsageStats,
}));

vi.mock('@taskforceai/browser-runtime/browser-actions', () => ({
  writeClipboardText: mockWriteClipboardText,
  confirmAction: mockConfirmAction,
  showAlert: mockShowAlert,
}));

vi.mock('../lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

import { Route } from './api-keys';

const buildStats = (overrides: Partial<UsageStats> = {}): UsageStats => ({
  totalRequests: 1300,
  requestsThisMonth: 120,
  requestsThisWeek: 30,
  requestsToday: 4,
  monthlyQuota: 10_000,
  monthlyRemaining: 9_880,
  periodStart: '2026-02-01T00:00:00.000Z',
  periodEnd: '2026-02-28T23:59:59.000Z',
  apiKeys: [
    {
      keyId: 101,
      displayKey: 'tfai_live_existing',
      tier: 'free',
      createdAt: '2026-02-01T12:00:00.000Z',
      lastUsedAt: '2026-02-10T08:30:00.000Z',
      revokedAt: null,
      hourlyLimit: 100,
      monthlyQuota: 10_000,
      currentHourlyUsage: 2,
      dailyUsage: 12,
      weeklyUsage: 45,
      monthlyUsage: 120,
    },
  ],
  usageHistory: [
    { date: '2026-02-09T00:00:00.000Z', count: 4 },
    { date: '2026-02-10T00:00:00.000Z', count: 6 },
  ],
  ...overrides,
});

const setUsageStats = (stats: UsageStats) => {
  mockUseDeveloperUsageStats.mockReturnValue({
    loading: false,
    refresh: mockRefreshUsageStats,
    stats,
  });
};

const getApiKeysPage = () => {
  const route = Route as unknown as {
    component?: ComponentType;
    options?: { component?: ComponentType };
  };
  const APIKeysPage = route.options?.component ?? route.component;
  if (!APIKeysPage) {
    throw new Error('api-keys route component is unavailable');
  }
  return APIKeysPage;
};

const renderApiKeysPage = () => {
  const APIKeysPage = getApiKeysPage();
  return render(<APIKeysPage />);
};

describe('api-keys route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      user: { id: 7, email: 'first@example.com' },
    });
    mockGetSignInUrl.mockReturnValue('https://auth.taskforce.test/sign-in');
    setUsageStats(buildStats());
    mockRefreshUsageStats.mockResolvedValue(ok(buildStats()));
    mockCreateDeveloperApiKey.mockResolvedValue(ok({ apiKey: 'tfai_secret_new_key' }));
    mockRevokeDeveloperApiKey.mockResolvedValue(ok({ status: 'revoked' }));
    mockWriteClipboardText.mockResolvedValue(ok(true));
    mockConfirmAction.mockReturnValue(ok(true));
    mockShowAlert.mockReturnValue(ok(true));
  });

  it('shows auth gate for unauthenticated users and starts sign-in', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false, isLoading: false, user: null });

    renderApiKeysPage();

    expect(
      screen.getByText(
        'You need to be signed in to manage your API keys and access the TaskForceAI platform.'
      )
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in to continue' }));

    expect(mockGetSignInUrl).toHaveBeenCalledWith({
      callbackUrl: expect.stringContaining('http://localhost'),
    });
  });

  it('shows a loading state while authentication is bootstrapping', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false, isLoading: true, user: null });

    renderApiKeysPage();

    expect(screen.getByText('Loading API keys')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in to continue' })).not.toBeInTheDocument();
    expect(mockRefreshUsageStats).not.toHaveBeenCalled();
  });

  it('shows a loading state while authenticated usage stats load', () => {
    mockUseDeveloperUsageStats.mockReturnValue({
      loading: true,
      refresh: mockRefreshUsageStats,
      stats: null,
    });

    const { container } = renderApiKeysPage();

    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('creates a key, refreshes usage stats, and copies the new key from modal', async () => {
    mockRefreshUsageStats.mockResolvedValue(ok(buildStats({ requestsThisMonth: 222 })));
    mockCreateDeveloperApiKey.mockResolvedValue(ok({ apiKey: 'tfai_secret_created_123' }));

    renderApiKeysPage();

    expect(await screen.findByText('tfai_live_existing')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create New Key' }));

    expect(mockCreateDeveloperApiKey).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Save your API Key')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('tfai_secret_created_123')).toBeInTheDocument();

    await waitFor(() => {
      expect(mockRefreshUsageStats).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Copy Key' }));

    await waitFor(() => {
      expect(mockWriteClipboardText).toHaveBeenCalledWith('tfai_secret_created_123');
    });
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('revokes an active key after confirmation and refreshes usage state', async () => {
    const initialStats = buildStats({
      apiKeys: [
        {
          keyId: 77,
          displayKey: 'tfai_live_revocable',
          tier: 'pro',
          createdAt: '2026-01-05T10:00:00.000Z',
          lastUsedAt: '2026-02-12T08:00:00.000Z',
          revokedAt: null,
          hourlyLimit: 500,
          monthlyQuota: 50_000,
          currentHourlyUsage: 10,
          dailyUsage: 30,
          weeklyUsage: 100,
          monthlyUsage: 350,
        },
      ],
    });
    setUsageStats(initialStats);
    mockRefreshUsageStats.mockResolvedValue(ok(initialStats));

    renderApiKeysPage();

    expect(await screen.findByText('tfai_live_revocable')).toBeInTheDocument();
    const row = screen.getByText('tfai_live_revocable').closest('tr');
    expect(row).not.toBeNull();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Revoke API key tfai_live_revocable',
      })
    );

    expect(mockConfirmAction).toHaveBeenCalledWith(
      'Are you sure you want to revoke API key tfai_live_revocable?'
    );
    await waitFor(() => {
      expect(mockRevokeDeveloperApiKey).toHaveBeenCalledWith(77);
      expect(mockRefreshUsageStats).toHaveBeenCalledTimes(1);
    });
  });

  it('renders revoked keys without a revoke action', () => {
    const activeKey = buildStats().apiKeys[0];
    if (!activeKey) throw new Error('Missing fixture API key at index 0');
    setUsageStats(
      buildStats({ apiKeys: [{ ...activeKey, revokedAt: '2026-02-12T10:00:00.000Z' }] })
    );

    renderApiKeysPage();

    const row = screen.getByText(activeKey.displayKey).closest('tr');
    expect(row).toHaveTextContent('Revoked');
    expect(row?.querySelector('button')).toBeNull();
  });

  it('shows alert when create key fails', async () => {
    mockCreateDeveloperApiKey.mockResolvedValue(
      err({ kind: 'server', message: 'Key limit reached', status: 429 })
    );

    renderApiKeysPage();

    fireEvent.click(screen.getByRole('button', { name: 'Create New Key' }));

    await waitFor(() => {
      expect(mockShowAlert).toHaveBeenCalledWith('Failed to create API key: Key limit reached');
    });
  });

  it('shows alert when revoke key fails', async () => {
    const initialStats = buildStats({
      apiKeys: [
        {
          keyId: 88,
          displayKey: 'tfai_live_missing',
          tier: 'free',
          createdAt: '2026-02-08T12:00:00.000Z',
          lastUsedAt: '2026-02-09T12:00:00.000Z',
          revokedAt: null,
          hourlyLimit: 100,
          monthlyQuota: 10_000,
          currentHourlyUsage: 1,
          dailyUsage: 5,
          weeklyUsage: 10,
          monthlyUsage: 40,
        },
      ],
    });
    setUsageStats(initialStats);
    mockRevokeDeveloperApiKey.mockResolvedValue(
      err({ kind: 'server', message: 'Key not found', status: 404 })
    );

    renderApiKeysPage();

    expect(await screen.findByText('tfai_live_missing')).toBeInTheDocument();
    const row = screen.getByText('tfai_live_missing').closest('tr');
    expect(row).not.toBeNull();
    const actionButtons = row?.querySelectorAll('button') ?? [];
    fireEvent.click(actionButtons[0] as HTMLButtonElement);

    await waitFor(() => {
      expect(mockShowAlert).toHaveBeenCalledWith('Failed to revoke API key: Key not found');
    });
  });

  it('does not revoke a key when user cancels confirmation', async () => {
    mockConfirmAction.mockReturnValue(ok(false));
    const initialStats = buildStats({
      apiKeys: [
        {
          keyId: 501,
          displayKey: 'tfai_live_cancelled_revoke',
          tier: 'pro',
          createdAt: '2026-02-08T12:00:00.000Z',
          lastUsedAt: '2026-02-09T12:00:00.000Z',
          revokedAt: null,
          hourlyLimit: 500,
          monthlyQuota: 50_000,
          currentHourlyUsage: 2,
          dailyUsage: 5,
          weeklyUsage: 10,
          monthlyUsage: 40,
        },
      ],
    });

    setUsageStats(initialStats);

    renderApiKeysPage();

    expect(await screen.findByText('tfai_live_cancelled_revoke')).toBeInTheDocument();
    const row = screen.getByText('tfai_live_cancelled_revoke').closest('tr');
    expect(row).not.toBeNull();
    const actionButtons = row?.querySelectorAll('button') ?? [];
    fireEvent.click(actionButtons[0] as HTMLButtonElement);

    expect(mockConfirmAction).toHaveBeenCalledWith(
      'Are you sure you want to revoke API key tfai_live_cancelled_revoke?'
    );
    expect(mockRevokeDeveloperApiKey).not.toHaveBeenCalled();
  });

  it('alerts when revoke confirmation cannot be shown', async () => {
    mockConfirmAction.mockReturnValue(
      err({ kind: 'permission', message: 'Confirm blocked', status: 403 })
    );

    renderApiKeysPage();

    expect(await screen.findByText('tfai_live_existing')).toBeInTheDocument();
    const row = screen.getByText('tfai_live_existing').closest('tr');
    const actionButtons = row?.querySelectorAll('button') ?? [];
    fireEvent.click(actionButtons[0] as HTMLButtonElement);

    expect(mockRevokeDeveloperApiKey).not.toHaveBeenCalled();
    expect(mockShowAlert).toHaveBeenCalledWith('Unable to confirm revocation. Please try again.');
  });

  it('does not expose a copy action for existing masked keys', async () => {
    renderApiKeysPage();

    expect(await screen.findByText('tfai_live_existing')).toBeInTheDocument();
    const row = screen.getByText('tfai_live_existing').closest('tr');
    expect(row).not.toBeNull();
    expect(row?.querySelectorAll('button')).toHaveLength(1);
    expect(mockWriteClipboardText).not.toHaveBeenCalled();
  });

  it('renders empty table message when no API keys are present', async () => {
    setUsageStats(buildStats({ apiKeys: [] }));

    renderApiKeysPage();

    expect(
      await screen.findByText('No API keys found. Create one to get started.')
    ).toBeInTheDocument();
  });

  it('logs warning when showAlert fails', async () => {
    const { logger } = await import('../lib/logger');
    const loggerWarnSpy = vi.spyOn(logger, 'warn');
    mockShowAlert.mockReturnValue(
      err({ kind: 'permission', message: 'Alert blocked', status: 403 })
    );

    mockCreateDeveloperApiKey.mockResolvedValue(
      err({ kind: 'server', message: 'Key limit reached', status: 429 })
    );

    renderApiKeysPage();

    fireEvent.click(screen.getByRole('button', { name: 'Create New Key' }));

    await waitFor(() => {
      expect(mockShowAlert).toHaveBeenCalledWith('Failed to create API key: Key limit reached');
    });

    expect(loggerWarnSpy).toHaveBeenCalledWith('Failed to show alert', {
      error: expect.objectContaining({ message: 'Alert blocked' }),
    });
    loggerWarnSpy.mockRestore();
  });

  it('handles promise rejection/throw when creating a key', async () => {
    const { logger } = await import('../lib/logger');
    const loggerErrorSpy = vi.spyOn(logger, 'error');
    mockCreateDeveloperApiKey.mockRejectedValue(new Error('Network disconnected'));

    renderApiKeysPage();

    fireEvent.click(screen.getByRole('button', { name: 'Create New Key' }));

    await waitFor(() => {
      expect(mockShowAlert).toHaveBeenCalledWith('Failed to create API key. Please try again.');
    });

    expect(loggerErrorSpy).toHaveBeenCalledWith('Failed to create API key', expect.any(Error));
    loggerErrorSpy.mockRestore();
  });

  it('handles promise rejection/throw when revoking a key', async () => {
    const { logger } = await import('../lib/logger');
    const loggerErrorSpy = vi.spyOn(logger, 'error');
    mockRevokeDeveloperApiKey.mockRejectedValue(new Error('Database unavailable'));

    renderApiKeysPage();

    expect(await screen.findByText('tfai_live_existing')).toBeInTheDocument();
    const row = screen.getByText('tfai_live_existing').closest('tr');
    const actionButtons = row?.querySelectorAll('button') ?? [];
    fireEvent.click(actionButtons[0] as HTMLButtonElement);

    await waitFor(() => {
      expect(mockRevokeDeveloperApiKey).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(mockShowAlert).toHaveBeenCalledWith('Failed to revoke API key. Please try again.');
    });

    expect(loggerErrorSpy).toHaveBeenCalledWith('Failed to revoke API key', expect.any(Error));
    loggerErrorSpy.mockRestore();
  });

  it('shows notification when key creation succeeds but stats refresh fails', async () => {
    mockCreateDeveloperApiKey.mockResolvedValue(ok({ apiKey: 'tfai_secret_success' }));
    mockRefreshUsageStats.mockResolvedValue(
      err({
        kind: 'server',
        message: 'Failed to refresh usage stats',
        status: 500,
      })
    );

    renderApiKeysPage();

    fireEvent.click(screen.getByRole('button', { name: 'Create New Key' }));

    await waitFor(() => {
      expect(mockShowAlert).toHaveBeenCalledWith(
        'Key created, but failed to fetch updated usage stats.'
      );
    });
  });

  it('shows notification when key revocation succeeds but stats refresh fails', async () => {
    mockRevokeDeveloperApiKey.mockResolvedValue(ok({ status: 'revoked' }));
    mockRefreshUsageStats.mockResolvedValue(
      err({
        kind: 'server',
        message: 'Failed to refresh usage stats',
        status: 500,
      })
    );

    renderApiKeysPage();

    expect(await screen.findByText('tfai_live_existing')).toBeInTheDocument();
    const row = screen.getByText('tfai_live_existing').closest('tr');
    const actionButtons = row?.querySelectorAll('button') ?? [];
    fireEvent.click(actionButtons[0] as HTMLButtonElement);

    await waitFor(() => {
      expect(mockShowAlert).toHaveBeenCalledWith(
        'Key revoked, but failed to fetch updated usage stats.'
      );
    });
  });

  it('logs error when modal copy throws unexpectedly', async () => {
    const { logger } = await import('../lib/logger');
    const loggerErrorSpy = vi.spyOn(logger, 'error');
    mockCreateDeveloperApiKey.mockResolvedValue(ok({ apiKey: 'tfai_secret_modal_copy' }));
    mockWriteClipboardText.mockRejectedValue(new Error('Clipboard permission denied'));

    renderApiKeysPage();

    fireEvent.click(screen.getByRole('button', { name: 'Create New Key' }));
    expect(await screen.findByText('Save your API Key')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Copy Key' }));

    await waitFor(() => {
      expect(loggerErrorSpy).toHaveBeenCalledWith('Failed to copy key', expect.any(Error));
    });

    loggerErrorSpy.mockRestore();
  });

  it('alerts when copying a generated key returns an error', async () => {
    mockCreateDeveloperApiKey.mockResolvedValue(ok({ apiKey: 'tfai_secret_copy_error' }));
    mockWriteClipboardText.mockResolvedValue(
      err({ kind: 'permission', message: 'Clipboard blocked', status: 403 })
    );

    renderApiKeysPage();
    fireEvent.click(screen.getByRole('button', { name: 'Create New Key' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Copy Key' }));

    await waitFor(() => {
      expect(mockShowAlert).toHaveBeenCalledWith('Clipboard blocked');
    });
  });

  it('closes the new key modal and clears the generated key', async () => {
    mockCreateDeveloperApiKey.mockResolvedValue(ok({ apiKey: 'tfai_secret_close_modal' }));

    renderApiKeysPage();

    fireEvent.click(screen.getByRole('button', { name: 'Create New Key' }));
    expect(await screen.findByText('tfai_secret_close_modal')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    await waitFor(() => {
      expect(screen.queryByText('Save your API Key')).toBeNull();
      expect(screen.queryByText('tfai_secret_close_modal')).toBeNull();
    });
  });

  it('clears a generated key when the authenticated user changes', async () => {
    const APIKeysPage = getApiKeysPage();
    mockCreateDeveloperApiKey.mockResolvedValue(ok({ apiKey: 'tfai_secret_first_user' }));
    const view = render(<APIKeysPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Create New Key' }));
    expect(await screen.findByText('tfai_secret_first_user')).toBeInTheDocument();

    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      user: { id: 8, email: 'second@example.com' },
    });
    view.rerender(<APIKeysPage />);

    await waitFor(() => {
      expect(screen.queryByText('tfai_secret_first_user')).toBeNull();
      expect(screen.queryByText('Save your API Key')).toBeNull();
    });
  });
});
