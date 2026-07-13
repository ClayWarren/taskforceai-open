import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import type { ComponentType } from 'react';

import '../../../../tests/setup/dom';

const mockUseQuery = vi.fn();
const mockUseMutation = vi.fn();
const mockCreatePortalSession = vi.fn();
const mockShowAlert = vi.fn();

type MutationOptions = {
  mutationFn: () => unknown | Promise<unknown>;
  onSuccess?: (result: any) => void;
  onError?: (error: unknown) => void;
};

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: any) => mockUseQuery(options),
  useMutation: (options: any) => mockUseMutation(options),
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: any) => options,
}));

vi.mock('@taskforceai/api-client/api/billing', () => ({
  fetchPaymentMethods: vi.fn(),
  createPortalSession: mockCreatePortalSession,
}));

vi.mock('@taskforceai/browser-runtime/browser-actions', () => ({
  showAlert: mockShowAlert,
}));

import { Route } from './billing.payment-methods';

const renderPaymentMethodsPage = () => {
  const route = Route as unknown as {
    component?: ComponentType;
    options?: { component?: ComponentType };
  };
  const PaymentMethodsPage = route.options?.component ?? route.component;
  if (!PaymentMethodsPage) {
    throw new Error('billing.payment-methods route component is unavailable');
  }
  return render(<PaymentMethodsPage />);
};

const okResult = <T,>(value: T) => ({ ok: true as const, value });

describe('billing payment methods route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseQuery.mockReturnValue({
      data: okResult([]),
      isLoading: false,
    });
    mockCreatePortalSession.mockResolvedValue(
      okResult({ url: 'https://billing.stripe.com/portal' })
    );
    mockUseMutation.mockImplementation((options: MutationOptions) => ({
      mutate: () => {
        Promise.resolve(options.mutationFn()).then(
          (result) => options.onSuccess?.(result),
          options.onError
        );
      },
      isPending: false,
    }));
    mockShowAlert.mockReturnValue(okResult(undefined));
    window.location.href = 'http://localhost/';
  });

  it('renders loading state while payment methods are loading', () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
    });

    const { container } = renderPaymentMethodsPage();

    expect(screen.queryByText('Payment methods')).toBeNull();
    expect(container.querySelector('svg.animate-spin')).not.toBeNull();
  });

  it('renders empty state when there are no saved payment methods', () => {
    renderPaymentMethodsPage();

    expect(screen.getByText('No payment methods found')).toBeInTheDocument();
    expect(screen.getByText("You haven't added any payment methods yet.")).toBeInTheDocument();
  });

  it('renders card brand labels and default badge for saved methods', () => {
    mockUseQuery.mockReturnValue({
      data: okResult([
        {
          id: 'pm_1',
          brand: 'visa',
          last4: '4242',
          expMonth: 8,
          expYear: 2030,
          isDefault: true,
        },
        {
          id: 'pm_2',
          brand: 'unknownbrand',
          last4: '0005',
          expMonth: 11,
          expYear: 2031,
          isDefault: false,
        },
      ]),
      isLoading: false,
    });

    renderPaymentMethodsPage();

    expect(screen.getByText('Visa')).toBeInTheDocument();
    expect(screen.getByText('•••• 4242')).toBeInTheDocument();
    expect(screen.getByText('Default')).toBeInTheDocument();
    expect(screen.getByText('unknownbrand')).toBeInTheDocument();
    expect(screen.getByText('Expires 11/2031')).toBeInTheDocument();
  });

  it('opens billing portal when adding a payment method', async () => {
    renderPaymentMethodsPage();

    fireEvent.click(screen.getByRole('button', { name: 'Add payment method' }));

    await waitFor(() => {
      expect(mockCreatePortalSession).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(window.location.href).toBe('https://billing.stripe.com/portal');
    });
  });

  it('renders unable to load state when payment methods query returns ok: false', () => {
    const refetchMock = vi.fn();
    mockUseQuery.mockReturnValue({
      data: { ok: false, error: { message: 'Failed to retrieve payment methods' } },
      isLoading: false,
      isFetching: false,
      refetch: refetchMock,
    });

    renderPaymentMethodsPage();

    expect(screen.getByText('Unable to load payment methods')).toBeInTheDocument();
    expect(screen.getByText('Failed to retrieve payment methods')).toBeInTheDocument();

    const retryButton = screen.getByRole('button', { name: 'Retry' });
    fireEvent.click(retryButton);
    expect(refetchMock).toHaveBeenCalled();
  });

  it('renders default error message when payment methods query data is undefined', () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });

    renderPaymentMethodsPage();

    expect(screen.getByText('Unable to load payment methods')).toBeInTheDocument();
    expect(screen.getByText('Payment methods are currently unavailable.')).toBeInTheDocument();
  });

  it('displays loading spinner inside Retry button when payment methods are fetching', () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: true,
      refetch: vi.fn(),
    });

    renderPaymentMethodsPage();

    const retryButton = screen.getByRole('button', { name: 'Retry' });
    expect(retryButton.hasAttribute('disabled')).toBe(true);
    expect(retryButton.querySelector('svg.animate-spin')).not.toBeNull();
  });

  it('alerts when Stripe portal redirection is rejected due to untrusted URL', async () => {
    const { logger } = await import('../lib/logger');
    const loggerWarnSpy = vi.spyOn(logger, 'warn');

    mockCreatePortalSession.mockResolvedValue(okResult({ url: 'https://evil.example/steal' }));

    renderPaymentMethodsPage();

    fireEvent.click(screen.getByRole('button', { name: 'Add payment method' }));

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

  it('alerts when billing portal session creation returns an error', async () => {
    mockCreatePortalSession.mockResolvedValue({
      ok: false,
      error: { kind: 'server', message: 'Stripe is unavailable', status: 503 },
    });

    renderPaymentMethodsPage();

    fireEvent.click(screen.getByRole('button', { name: 'Add payment method' }));

    await waitFor(() => {
      expect(mockShowAlert).toHaveBeenCalledWith(
        'Failed to open billing portal: Stripe is unavailable'
      );
    });
  });
});
