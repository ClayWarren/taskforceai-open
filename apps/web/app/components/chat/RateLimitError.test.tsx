import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import React from 'react';

import '../../../../../tests/setup/dom';
import { authClient } from '@taskforceai/api-client/auth/auth-client';
import { useOptionalProfileModal } from '../../lib/profile/modal/ProfileModalContext';
import { useAuth } from '../../lib/providers/AuthProvider';
import { startUpgradeCheckout } from '@taskforceai/api-client/services/upgrade-flow';
import RateLimitError from './RateLimitError';

// Local mock
const mockNavigateFn = vi.fn();
const navigateToMock = vi.fn();
const loggerErrorMock = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigateFn,
  useRouter: () => ({ navigate: mockNavigateFn }),
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock('@taskforceai/api-client/auth/auth-client', () => ({
  authClient: {
    getSignInUrl: vi.fn(() => '/api/v1/auth/login?callbackUrl=%2F'),
  },
}));

vi.mock('../routing', () => ({
  useNavigate: () => mockNavigateFn,
  useRouter: () => ({ navigate: mockNavigateFn }),
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock('../../lib/providers/AuthProvider', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../lib/profile/modal/ProfileModalContext', () => ({
  useOptionalProfileModal: vi.fn(),
}));

vi.mock('@taskforceai/api-client/services/upgrade-flow', () => ({
  startUpgradeCheckout: vi.fn(),
}));

vi.mock('@taskforceai/browser-runtime/browser-actions', () => ({
  navigateTo: navigateToMock,
}));

vi.mock('../../lib/logger', () => ({
  logger: {
    error: loggerErrorMock,
  },
}));

describe('RateLimitError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useOptionalProfileModal as any).mockReturnValue(undefined);
    navigateToMock.mockReturnValue({ ok: true });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders rate limit message and heading', () => {
    (useAuth as any).mockReturnValue({ user: null });
    render(<RateLimitError message="Too many requests" />);

    expect(screen.getByText('Rate Limit Reached')).toBeTruthy();
    expect(screen.getByText('Too many requests')).toBeTruthy();
  });

  it('renders reset time if provided', () => {
    (useAuth as any).mockReturnValue({ user: null });
    const resetTime = new Date('2025-01-01T12:00:00Z').toISOString();
    render(<RateLimitError message="Wait" resetTime={resetTime} />);

    expect(screen.getByText(/Your limit will reset on:/i)).toBeTruthy();
  });

  it('calls onDismiss when close button is clicked', () => {
    const onDismiss = vi.fn();
    (useAuth as any).mockReturnValue({ user: null });
    render(<RateLimitError message="Wait" onDismiss={onDismiss} />);

    const dismissBtn = screen.getByLabelText('Dismiss error');
    act(() => {
      fireEvent.click(dismissBtn);
    });
    expect(onDismiss).toHaveBeenCalled();
  });

  it('shows upgrade options for free users', () => {
    (useAuth as any).mockReturnValue({ user: { plan: 'free' } });
    render(<RateLimitError message="Upgrade now" />);

    expect(screen.getByText('Upgrade to Pro ($28/mo)')).toBeTruthy();
    expect(screen.getByText('Upgrade to Super ($280/mo)')).toBeTruthy();
  });

  it('shows only super option for pro users', () => {
    (useAuth as any).mockReturnValue({ user: { plan: 'pro' } });
    render(<RateLimitError message="Upgrade more" />);

    expect(screen.queryByText('Upgrade to Pro ($28/mo)')).toBeNull();
    expect(screen.getByText('Upgrade to Super ($280/mo)')).toBeTruthy();
  });

  it('does not render upgrade options for super users', () => {
    (useAuth as any).mockReturnValue({ user: { plan: 'super' } });
    render(<RateLimitError message="Already on the highest plan" />);

    expect(screen.queryByText('Upgrade for more throughput')).toBeNull();
    expect(screen.queryByRole('button', { name: /upgrade to/i })).toBeNull();
  });

  it('starts sign-in with plan callback if unauthenticated user clicks upgrade', () => {
    (useAuth as any).mockReturnValue({ user: null });

    render(<RateLimitError message="Upgrade required" />);
    const upgradeBtn = screen.getByRole('button', { name: /Upgrade to Pro/i });
    act(() => {
      fireEvent.click(upgradeBtn);
    });

    expect(authClient.getSignInUrl).toHaveBeenCalledWith({
      callbackUrl: '/?plan=pro',
    });
  });

  it('starts sign-in from the explicit sign-in button', () => {
    (useAuth as any).mockReturnValue({ user: null });

    render(<RateLimitError message="Sign up" />);
    const signInBtn = screen.getByRole('button', {
      name: /Sign in to TaskForceAI/i,
    });
    act(() => {
      fireEvent.click(signInBtn);
    });

    expect(authClient.getSignInUrl).toHaveBeenCalledWith({
      callbackUrl: '/',
    });
  });

  it('opens profile modal when upgrade is clicked', async () => {
    const mockOpen = vi.fn();
    (useOptionalProfileModal as any).mockReturnValue({ open: mockOpen });
    (useAuth as any).mockReturnValue({ user: { plan: 'free' } });
    (startUpgradeCheckout as any).mockRejectedValue(new Error('checkout failed'));

    render(<RateLimitError message="Upgrade" />);
    const upgradeBtn = screen.getByText('Upgrade to Pro ($28/mo)');
    await act(async () => {
      fireEvent.click(upgradeBtn);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockOpen).toHaveBeenCalled();
  });

  it('navigates to checkout for authenticated upgrades', async () => {
    (useAuth as any).mockReturnValue({ user: { plan: 'free' } });
    (startUpgradeCheckout as any).mockResolvedValue({
      ok: true,
      value: { checkoutUrl: 'https://billing.example/checkout' },
    });

    render(<RateLimitError message="Upgrade" />);
    const upgradeBtn = screen.getByText('Upgrade to Super ($280/mo)');
    await act(async () => {
      fireEvent.click(upgradeBtn);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(startUpgradeCheckout).toHaveBeenCalledWith({ targetPlan: 'super' });
    expect(navigateToMock).toHaveBeenCalledWith('https://billing.example/checkout');
  });

  it('shows a fallback error when checkout returns a failure result', async () => {
    const mockOpen = vi.fn();
    (useOptionalProfileModal as any).mockReturnValue({ open: mockOpen });
    (useAuth as any).mockReturnValue({ user: { plan: 'free' } });
    (startUpgradeCheckout as any).mockResolvedValue({
      ok: false,
      error: { message: 'checkout unavailable' },
    });

    render(<RateLimitError message="Upgrade" />);
    await act(async () => {
      fireEvent.click(screen.getByText('Upgrade to Pro ($28/mo)'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(loggerErrorMock).toHaveBeenCalledWith(
      'Failed to start upgrade checkout',
      expect.objectContaining({ targetPlan: 'pro' })
    );
    expect(mockOpen).toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/temporarily unavailable/i);
  });

  it('shows a fallback error when checkout navigation fails', async () => {
    const mockOpen = vi.fn();
    (useOptionalProfileModal as any).mockReturnValue({ open: mockOpen });
    (useAuth as any).mockReturnValue({ user: { plan: 'free' } });
    (startUpgradeCheckout as any).mockResolvedValue({
      ok: true,
      value: { checkoutUrl: 'https://billing.example/checkout' },
    });
    navigateToMock.mockReturnValue({
      ok: false,
      error: { message: 'blocked navigation' },
    });

    render(<RateLimitError message="Upgrade" />);
    await act(async () => {
      fireEvent.click(screen.getByText('Upgrade to Pro ($28/mo)'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(loggerErrorMock).toHaveBeenCalledWith(
      'Failed to start upgrade checkout',
      expect.objectContaining({ targetPlan: 'pro' })
    );
    expect(mockOpen).toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/temporarily unavailable/i);
  });
});
