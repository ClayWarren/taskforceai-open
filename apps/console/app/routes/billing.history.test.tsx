import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import type { ComponentType } from 'react';

import '../../../../tests/setup/dom';

const mockUseQuery = vi.fn();
const mockUseAuth = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: any) => mockUseQuery(options),
}));

vi.mock('@taskforceai/ui-kit/auth/AuthProvider', () => ({
  useAuth: mockUseAuth,
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: any) => options,
}));

import { Route } from './billing.history';

const renderBillingHistoryPage = () => {
  const route = Route as unknown as {
    component?: ComponentType;
    options?: { component?: ComponentType };
  };
  const BillingHistoryPage = route.options?.component ?? route.component;
  if (!BillingHistoryPage) {
    throw new Error('billing.history route component is unavailable');
  }
  return render(<BillingHistoryPage />);
};

const okResult = <T,>(value: T) => ({ ok: true as const, value });

describe('billing history route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ user: { id: 7, email: 'owner@example.com' } });
    mockUseQuery.mockReturnValue({
      data: okResult([]),
      isLoading: false,
    });
  });

  it('scopes invoice queries to the authenticated user', () => {
    renderBillingHistoryPage();

    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['billing', 'id-7', 'invoices'] })
    );
  });

  it('renders loading indicator while invoices are loading', () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
    });

    const { container } = renderBillingHistoryPage();

    expect(screen.queryByText('Billing history')).toBeNull();
    expect(container.querySelector('svg.animate-spin')).not.toBeNull();
  });

  it('renders empty state when no invoices are available', () => {
    renderBillingHistoryPage();

    expect(screen.getByText('No invoices yet')).toBeInTheDocument();
    expect(
      screen.getByText('Your invoice history will appear here once you make a purchase.')
    ).toBeInTheDocument();
  });

  it('renders invoices with status mapping, fallbacks, and external links', () => {
    mockUseQuery.mockReturnValue({
      data: okResult([
        {
          id: 'inv_paid',
          createdAt: 1738454400,
          number: 'INV-1001',
          amountPaid: 299,
          currency: 'usd',
          status: 'paid',
          invoicePdf: 'https://billing.stripe.com/inv_paid.pdf',
          hostedUrl: 'https://billing.stripe.com/inv_paid',
        },
        {
          id: 'inv_pending',
          createdAt: 1738540800,
          number: null,
          amountPaid: 1200,
          currency: 'usd',
          status: 'open',
          invoicePdf: null,
          hostedUrl: 'https://billing.stripe.com/inv_pending',
        },
        {
          id: 'inv_failed',
          createdAt: 1738627200,
          number: 'INV-1003',
          amountPaid: 500,
          currency: 'usd',
          status: 'void',
          invoicePdf: null,
          hostedUrl: null,
        },
        {
          id: 'inv_custom',
          createdAt: 1738713600,
          number: 'INV-1004',
          amountPaid: 700,
          currency: 'usd',
          status: 'draft',
          invoicePdf: null,
          hostedUrl: null,
        },
      ]),
      isLoading: false,
    });

    const { container } = renderBillingHistoryPage();

    expect(screen.getByText('INV-1001')).toBeInTheDocument();
    expect(screen.getByText('$299.00')).toBeInTheDocument();
    expect(screen.getByText('Paid')).toBeInTheDocument();

    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('draft')).toBeInTheDocument();

    const pdfLink = container.querySelector('a[title="Download PDF"]');
    expect(pdfLink).not.toBeNull();
    expect(pdfLink?.getAttribute('href')).toBe('https://billing.stripe.com/inv_paid.pdf');
    expect(pdfLink?.getAttribute('target')).toBe('_blank');

    const viewLinks = container.querySelectorAll('a[title="View invoice"]');
    expect(viewLinks.length).toBe(2);
  });

  it('falls back to USD formatting for invalid currency codes', () => {
    mockUseQuery.mockReturnValue({
      data: okResult([
        {
          id: 'inv_invalid_currency',
          createdAt: 1738454400,
          number: 'INV-2001',
          amountPaid: 42,
          currency: 'invalid-code',
          status: 'paid',
          invoicePdf: null,
          hostedUrl: null,
        },
      ]),
      isLoading: false,
    });

    renderBillingHistoryPage();

    expect(screen.getByText('INV-2001')).toBeInTheDocument();
    expect(screen.getByText('$42.00')).toBeInTheDocument();
  });

  it('suppresses untrusted invoice URLs', () => {
    mockUseQuery.mockReturnValue({
      data: okResult([
        {
          id: 'inv_untrusted',
          createdAt: 1738454400,
          number: 'INV-3001',
          amountPaid: 20,
          currency: 'usd',
          status: 'paid',
          invoicePdf: 'https://evil.example/steal.pdf',
          hostedUrl: 'https://evil.example/steal',
        },
      ]),
      isLoading: false,
    });

    const { container } = renderBillingHistoryPage();

    expect(screen.getByText('INV-3001')).toBeInTheDocument();
    expect(container.querySelector('a[title="Download PDF"]')).toBeNull();
    expect(container.querySelector('a[title="View invoice"]')).toBeNull();
  });

  it('renders unable to load state when invoices query returns ok: false', () => {
    const refetchMock = vi.fn();
    mockUseQuery.mockReturnValue({
      data: { ok: false, error: { message: 'Database failed connection' } },
      isLoading: false,
      isFetching: false,
      refetch: refetchMock,
    });

    renderBillingHistoryPage();

    expect(screen.getByText('Unable to load billing history')).toBeInTheDocument();
    expect(screen.getByText('Database failed connection')).toBeInTheDocument();

    const retryButton = screen.getByRole('button', { name: 'Retry' });
    fireEvent.click(retryButton);
    expect(refetchMock).toHaveBeenCalled();
  });

  it('renders default error message when invoices query data is undefined', () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });

    renderBillingHistoryPage();

    expect(screen.getByText('Unable to load billing history')).toBeInTheDocument();
    expect(screen.getByText('Billing history is currently unavailable.')).toBeInTheDocument();
  });

  it('displays loading spinner inside Retry button when fetching is in progress', () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: true,
      refetch: vi.fn(),
    });

    renderBillingHistoryPage();

    const retryButton = screen.getByRole('button', { name: 'Retry' });
    expect(retryButton.hasAttribute('disabled')).toBe(true);
    expect(retryButton.querySelector('svg.animate-spin')).not.toBeNull();
  });

  it('catches and formats with USD fallback when Intl currency formatting throws', async () => {
    const { logger } = await import('../lib/logger');
    const loggerWarnSpy = vi.spyOn(logger, 'warn');
    const originalNumberFormat = Intl.NumberFormat;
    Object.defineProperty(Intl, 'NumberFormat', {
      configurable: true,
      writable: true,
      value: function MockNumberFormat(
        locale?: Intl.LocalesArgument,
        options?: Intl.NumberFormatOptions
      ) {
        if (options?.currency === 'ERR') {
          throw new RangeError('Invalid currency code');
        }
        return new originalNumberFormat(locale, options);
      },
    });

    try {
      mockUseQuery.mockReturnValue({
        data: okResult([
          {
            id: 'inv_format_throw',
            createdAt: 1738454400,
            number: 'INV-4001',
            amountPaid: 99,
            currency: 'ERR',
            status: 'paid',
            invoicePdf: null,
            hostedUrl: null,
          },
        ]),
        isLoading: false,
      });

      renderBillingHistoryPage();

      expect(screen.getByText('INV-4001')).toBeInTheDocument();
      expect(screen.getByText('$99.00')).toBeInTheDocument();
      expect(loggerWarnSpy).toHaveBeenCalledWith('Failed to format invoice currency', {
        currency: 'ERR',
        error: expect.any(RangeError),
      });
    } finally {
      Object.defineProperty(Intl, 'NumberFormat', {
        configurable: true,
        writable: true,
        value: originalNumberFormat,
      });
      loggerWarnSpy.mockRestore();
    }
  });
});
