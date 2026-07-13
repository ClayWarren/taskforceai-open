import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import type { AnchorHTMLAttributes, ComponentType, ReactNode } from 'react';

import '../../../../tests/setup/dom';

const mockUseAuth = vi.fn();
const mockGetSignInUrl = vi.fn();
const mockUseLocation = vi.fn();

vi.mock('@taskforceai/ui-kit/auth/AuthProvider', () => ({
  useAuth: mockUseAuth,
}));

vi.mock('@taskforceai/api-client/auth/auth-client', () => ({
  authClient: {
    getSignInUrl: mockGetSignInUrl,
  },
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: any) => options,
  Link: ({
    children,
    to,
    className,
  }: {
    children: ReactNode;
    to: string;
    className?: string;
  } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={to} className={className} data-router-link="true">
      {children}
    </a>
  ),
  Outlet: () => <div data-testid="billing-outlet" />,
  useLocation: mockUseLocation,
}));

import { Route } from './billing';

const renderBillingLayout = () => {
  const route = Route as unknown as {
    component?: ComponentType;
    options?: { component?: ComponentType };
  };
  const BillingLayout = route.options?.component ?? route.component;
  if (!BillingLayout) {
    throw new Error('billing route component is unavailable');
  }
  return render(<BillingLayout />);
};

describe('billing route layout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseLocation.mockReturnValue({ pathname: '/billing' });
    mockGetSignInUrl.mockReturnValue('https://auth.taskforce.test/sign-in');
  });

  it('renders sign-in gate for unauthenticated users and starts auth flow', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false, isLoading: false });

    renderBillingLayout();

    expect(screen.getByText('Billing')).toBeInTheDocument();
    expect(
      screen.getByText('Sign in to manage your subscription, payment methods, and invoices.')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in to continue' }));
    expect(mockGetSignInUrl).toHaveBeenCalledWith({
      callbackUrl: expect.stringContaining('http://localhost'),
    });
  });

  it('renders authenticated tab navigation and billing outlet', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true, isLoading: false });

    renderBillingLayout();

    const overviewLink = screen.getByRole('link', { name: 'Overview' });
    expect(overviewLink.getAttribute('href')).toBe('/billing');
    expect(overviewLink.className).toContain('border-blue-500');
    expect(overviewLink.className).toContain('text-blue-400');
    expect(screen.getByRole('link', { name: 'Payment methods' }).getAttribute('href')).toBe(
      '/billing/payment-methods'
    );
    expect(screen.getByRole('link', { name: 'Billing history' }).getAttribute('href')).toBe(
      '/billing/history'
    );
    expect(screen.getByRole('link', { name: 'Preferences' }).getAttribute('href')).toBe(
      '/billing/preferences'
    );
    expect(screen.getByTestId('billing-outlet')).toBeInTheDocument();
  });

  it('shows a loading state while authentication is bootstrapping', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false, isLoading: true });

    renderBillingLayout();

    expect(screen.getByText('Loading billing account')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in to continue' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('billing-outlet')).not.toBeInTheDocument();
  });
});
