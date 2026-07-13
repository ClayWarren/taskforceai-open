import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import type { AnchorHTMLAttributes, ReactNode } from 'react';

import '../../../../../tests/setup/dom';

const mockUseAuth = vi.fn();
const mockGetSignInUrl = vi.fn();
const mockClearCachedUsageStats = vi.fn();
const mockLoggerWarn = vi.fn();
const mockUseLocation = vi.fn();

vi.mock('@taskforceai/ui-kit/auth/AuthProvider', () => ({
  useAuth: mockUseAuth,
}));

vi.mock('@taskforceai/api-client/auth/auth-client', () => ({
  authClient: {
    getSignInUrl: mockGetSignInUrl,
  },
}));

vi.mock('../../lib/developer/developer-dashboard', () => ({
  clearCachedUsageStats: mockClearCachedUsageStats,
}));

vi.mock('../../lib/logger', () => ({
  logger: {
    warn: mockLoggerWarn,
  },
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    ...props
  }: {
    children: ReactNode;
    to: string;
  } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={to} data-router-link="true" {...props}>
      {children}
    </a>
  ),
  useLocation: mockUseLocation,
}));

import { ConsoleSidebar } from './ConsoleSidebar';

describe('ConsoleSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.location.href = 'http://localhost/usage';
    mockUseLocation.mockReturnValue({ pathname: '/' });
    mockGetSignInUrl.mockReturnValue('https://auth.taskforce.test/sign-in');
    mockClearCachedUsageStats.mockReturnValue({ ok: true });
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      user: {
        full_name: 'Clay Warren',
        email: 'clay@taskforceai.chat',
      },
      logout: vi.fn(),
    });
  });

  it('marks the active route based on the current location', () => {
    mockUseLocation.mockReturnValue({ pathname: '/billing/history' });

    render(<ConsoleSidebar isOpen={true} onClose={vi.fn()} />);

    const billingLink = screen.getByText('Billing').closest('a');
    const apiKeysLink = screen.getByText('API Keys').closest('a');

    expect(billingLink?.className).toContain('bg-white/5 text-white');
    expect(apiKeysLink?.className).not.toContain('bg-white/5 text-white');
  });

  it('starts sign-in with the current URL as callback for unauthenticated users', () => {
    const onClose = vi.fn();
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      user: null,
      logout: vi.fn(),
    });

    render(<ConsoleSidebar isOpen={true} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockGetSignInUrl).toHaveBeenCalledWith({
      callbackUrl: 'http://localhost/usage',
    });
    expect(window.location.href).toBe('https://auth.taskforce.test/sign-in');
  });

  it('closes the mobile sidebar when the overlay or nav links are clicked', () => {
    const onClose = vi.fn();

    const { container } = render(<ConsoleSidebar isOpen={true} onClose={onClose} />);

    const overlay = container.querySelector('.fixed.inset-0.z-40');
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay as Element);
    fireEvent.click(screen.getByText('API Keys'));
    fireEvent.click(screen.getByText('Documentation'));

    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('clears cached usage stats and logs out authenticated users', async () => {
    const logout = vi.fn();
    const onClose = vi.fn();
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      user: {
        full_name: 'Clay Warren',
        email: 'clay@taskforceai.chat',
      },
      logout,
    });

    render(<ConsoleSidebar isOpen={true} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockClearCachedUsageStats).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(logout).toHaveBeenCalledTimes(1);
    });
  });

  it('warns when usage cache clearing fails but still logs out', async () => {
    const logout = vi.fn();
    const storageError = { kind: 'storage', message: 'No storage' };
    mockClearCachedUsageStats.mockReturnValue({ ok: false, error: storageError });
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      user: {
        full_name: 'Clay Warren',
        email: 'clay@taskforceai.chat',
      },
      logout,
    });

    render(<ConsoleSidebar isOpen={true} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'Failed to clear developer usage cache during logout',
      { error: storageError }
    );
    await waitFor(() => {
      expect(logout).toHaveBeenCalledTimes(1);
    });
  });
});
