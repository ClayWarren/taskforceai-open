import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import type { ComponentType, ReactNode } from 'react';

import '../../../../tests/setup/dom';

const mockUseQuery = vi.fn();
const mockUseMutation = vi.fn();
const mockInvalidateQueries = vi.fn();

const mockUpdateAutoRecharge = vi.fn();
const mockCreatePortalSession = vi.fn();
const mockCancelSubscription = vi.fn();
const mockReactivateSubscription = vi.fn();
const mockConfirmAction = vi.fn();
const mockShowAlert = vi.fn();

type MutationOptions<TArg = unknown, TResult = unknown> = {
  mutationFn: (value: TArg) => TResult | Promise<TResult>;
  onSuccess?: (value: TResult) => void;
  onError?: (error: unknown) => void;
};

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: any) => mockUseQuery(options),
  useMutation: (options: any) => mockUseMutation(options),
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: any) => options,
  Link: ({ children, to }: { children: ReactNode; to: string }) => (
    <a href={to} data-router-link="true">
      {children}
    </a>
  ),
}));

vi.mock('../lib/api/billing', () => ({
  fetchBalance: vi.fn(),
  updateAutoRecharge: mockUpdateAutoRecharge,
  createPortalSession: mockCreatePortalSession,
}));

vi.mock('../lib/api/subscriptions', () => ({
  cancelSubscription: mockCancelSubscription,
  reactivateSubscription: mockReactivateSubscription,
}));

vi.mock('../lib/platform/browser-actions', () => ({
  confirmAction: mockConfirmAction,
  showAlert: mockShowAlert,
}));

import { Route } from './billing.index';

const renderBillingOverviewPage = () => {
  const route = Route as unknown as {
    component?: ComponentType;
    options?: { component?: ComponentType };
  };
  const BillingOverviewPage = route.options?.component ?? route.component;
  if (!BillingOverviewPage) {
    throw new Error('billing.index route component is unavailable');
  }
  return render(<BillingOverviewPage />);
};

const okResult = <T,>(value: T) => ({ ok: true as const, value });

const buildBalance = (overrides: Record<string, unknown> = {}) =>
  okResult({
    creditBalance: 42.5,
    autoRechargeEnabled: false,
    subscriptionId: 'sub_123',
    cancelAtPeriodEnd: false,
    ...overrides,
  });

const setupMutationHooks = () => {
  mockUseMutation.mockImplementation((options: MutationOptions) => ({
    mutate: (value?: unknown) => {
      Promise.resolve(options.mutationFn(value)).then((result) => {
        options.onSuccess?.(result);
      }, options.onError);
    },
    isPending: false,
  }));
};

describe('billing overview route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMutationHooks();
    mockUseQuery.mockReturnValue({
      data: buildBalance(),
      isLoading: false,
    });
    mockUpdateAutoRecharge.mockResolvedValue(okResult({ status: 'updated' }));
    mockCreatePortalSession.mockResolvedValue(
      okResult({ url: 'https://billing.stripe.com/portal' })
    );
    mockCancelSubscription.mockResolvedValue(okResult({ status: 'cancelled' }));
    mockReactivateSubscription.mockResolvedValue(okResult({ status: 'active' }));
    mockConfirmAction.mockReturnValue(okResult(true));
    mockShowAlert.mockReturnValue(okResult(undefined));
    window.location.href = 'http://localhost/';
  });

  it('renders loading state while billing balance is being fetched', () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
    });

    const { container } = renderBillingOverviewPage();

    expect(screen.queryByText('Pay as you go')).toBeNull();
    expect(container.querySelector('svg.animate-spin')).not.toBeNull();
  });

  it('enables auto recharge with configured amount and threshold', async () => {
    mockUseQuery.mockReturnValue({
      data: buildBalance({ autoRechargeEnabled: false }),
      isLoading: false,
    });

    renderBillingOverviewPage();

    fireEvent.click(screen.getByRole('button', { name: 'Enable auto recharge' }));

    await waitFor(() => {
      expect(mockUpdateAutoRecharge).toHaveBeenCalledWith({
        enabled: true,
        amount: 10,
        threshold: 5,
      });
    });
    await waitFor(() => {
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['billing', 'balance'] });
    });
  });

  it('disables auto recharge and clears amount and threshold', async () => {
    mockUseQuery.mockReturnValue({
      data: buildBalance({ autoRechargeEnabled: true }),
      isLoading: false,
    });

    renderBillingOverviewPage();

    fireEvent.click(screen.getByRole('button', { name: 'Disable auto recharge' }));

    await waitFor(() => {
      expect(mockUpdateAutoRecharge).toHaveBeenCalledWith({
        enabled: false,
        amount: null,
        threshold: null,
      });
    });
  });

  it('renders cancel-plan state and cancels active subscriptions', async () => {
    mockUseQuery.mockReturnValue({
      data: buildBalance({
        subscriptionId: 'sub_active',
        cancelAtPeriodEnd: false,
      }),
      isLoading: false,
    });

    renderBillingOverviewPage();

    expect(screen.getByRole('button', { name: 'Cancel plan' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reactivate plan' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel plan' }));

    expect(mockConfirmAction).toHaveBeenCalledWith(
      'Cancel your plan at the end of the current billing period?'
    );
    await waitFor(() => {
      expect(mockCancelSubscription).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['billing', 'balance'] });
    });
  });

  it('does not cancel an active subscription when confirmation is dismissed', async () => {
    mockConfirmAction.mockReturnValue(okResult(false));

    renderBillingOverviewPage();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel plan' }));

    expect(mockCancelSubscription).not.toHaveBeenCalled();
  });

  it('renders reactivation state when cancellation is scheduled', async () => {
    mockUseQuery.mockReturnValue({
      data: buildBalance({
        subscriptionId: 'sub_canceling',
        cancelAtPeriodEnd: true,
      }),
      isLoading: false,
    });

    renderBillingOverviewPage();

    expect(
      screen.getByText(
        'Your subscription will be canceled at the end of the current billing period.'
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reactivate plan' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel plan' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Reactivate plan' }));

    await waitFor(() => {
      expect(mockReactivateSubscription).toHaveBeenCalledTimes(1);
    });
  });

  it('opens Stripe portal and redirects when adding credit balance', async () => {
    renderBillingOverviewPage();

    fireEvent.click(screen.getByRole('button', { name: 'Add to credit balance' }));

    await waitFor(() => {
      expect(mockCreatePortalSession).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(window.location.href).toBe('https://billing.stripe.com/portal');
    });
  });

  it('renders billing action cards with internal and external navigation', () => {
    renderBillingOverviewPage();

    expect(
      screen.getByRole('link', { name: 'Payment methods Add or change payment method' })
    ).toHaveAttribute('href', '/billing/payment-methods');
    expect(
      screen.getByRole('link', { name: 'Billing history View past and current invoices' })
    ).toHaveAttribute('href', '/billing/history');
    expect(
      screen.getByRole('link', { name: 'Preferences Manage billing information' })
    ).toHaveAttribute('href', '/billing/preferences');

    const pricingLink = screen.getByRole('link', { name: 'Pricing View pricing and FAQs' });
    expect(pricingLink).toHaveAttribute('href', 'https://taskforceai.chat/pricing');
    expect(pricingLink).toHaveAttribute('target', '_blank');
    expect(pricingLink).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders unable to load state when balance query returns ok: false', () => {
    const refetchMock = vi.fn();
    mockUseQuery.mockReturnValue({
      data: { ok: false, error: { message: 'Failed to retrieve balance information' } },
      isLoading: false,
      isFetching: false,
      refetch: refetchMock,
    });

    renderBillingOverviewPage();

    expect(screen.getByText('Unable to load billing overview')).toBeInTheDocument();
    expect(screen.getByText('Failed to retrieve balance information')).toBeInTheDocument();

    const retryButton = screen.getByRole('button', { name: 'Retry' });
    fireEvent.click(retryButton);
    expect(refetchMock).toHaveBeenCalled();
  });

  it('renders default error message when balance query data is undefined', () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });

    renderBillingOverviewPage();

    expect(screen.getByText('Unable to load billing overview')).toBeInTheDocument();
    expect(screen.getByText('Billing balance is currently unavailable.')).toBeInTheDocument();
  });

  it('displays loading spinner inside Retry button when balance is fetching', () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: true,
      refetch: vi.fn(),
    });

    renderBillingOverviewPage();

    const retryButton = screen.getByRole('button', { name: 'Retry' });
    expect(retryButton.hasAttribute('disabled')).toBe(true);
    expect(retryButton.querySelector('svg.animate-spin')).not.toBeNull();
  });

  it('alerts when Stripe portal redirection is rejected due to untrusted URL', async () => {
    const { logger } = await import('../lib/logger');
    const loggerWarnSpy = vi.spyOn(logger, 'warn');

    mockCreatePortalSession.mockResolvedValue(okResult({ url: 'https://evil.example/steal' }));

    renderBillingOverviewPage();

    fireEvent.click(screen.getByRole('button', { name: 'Add to credit balance' }));

    await waitFor(() => {
      expect(mockCreatePortalSession).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(loggerWarnSpy).toHaveBeenCalledWith('Rejected billing portal redirect URL', {
        url: 'https://evil.example/steal',
        reason: 'untrusted',
      });
    });
    expect(mockShowAlert).toHaveBeenCalledWith(
      'Billing portal redirect was blocked because the URL was not trusted.'
    );

    loggerWarnSpy.mockRestore();
  });

  it('alerts when Stripe portal session creation returns an error', async () => {
    mockCreatePortalSession.mockResolvedValue({
      ok: false,
      error: { kind: 'server', message: 'Customer has no Stripe profile', status: 400 },
    });

    renderBillingOverviewPage();

    fireEvent.click(screen.getByRole('button', { name: 'Add to credit balance' }));

    await waitFor(() => {
      expect(mockShowAlert).toHaveBeenCalledWith(
        'Failed to open billing portal: Customer has no Stripe profile'
      );
    });
  });

  it('alerts when cancel plan returns an error result', async () => {
    mockCancelSubscription.mockResolvedValue({
      ok: false,
      error: { kind: 'server', message: 'Subscription not found', status: 404 },
    });

    renderBillingOverviewPage();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel plan' }));

    await waitFor(() => {
      expect(mockShowAlert).toHaveBeenCalledWith('Failed to cancel plan: Subscription not found');
    });
  });
});
