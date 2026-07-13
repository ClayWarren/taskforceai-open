import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import type { ComponentType } from 'react';

import '../../../../tests/setup/dom';

const mockUseMutation = vi.fn();
const mockCreatePortalSession = vi.fn();
const mockShowAlert = vi.fn();

type MutationOptions = {
  mutationFn: () => unknown | Promise<unknown>;
  onSuccess?: (result: any) => void;
  onError?: (error: unknown) => void;
};

vi.mock('@tanstack/react-query', () => ({
  useMutation: (options: any) => mockUseMutation(options),
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: any) => options,
}));

vi.mock('@taskforceai/api-client/api/billing', () => ({
  createPortalSession: mockCreatePortalSession,
}));

vi.mock('@taskforceai/browser-runtime/browser-actions', () => ({
  showAlert: mockShowAlert,
}));

import { Route } from './billing.preferences';

const renderBillingPreferencesPage = () => {
  const route = Route as unknown as {
    component?: ComponentType;
    options?: { component?: ComponentType };
  };
  const BillingPreferencesPage = route.options?.component ?? route.component;
  if (!BillingPreferencesPage) {
    throw new Error('billing.preferences route component is unavailable');
  }
  return render(<BillingPreferencesPage />);
};

const okResult = <T,>(value: T) => ({ ok: true as const, value });

describe('billing preferences route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('opens Stripe billing portal from preferences page', async () => {
    renderBillingPreferencesPage();

    expect(screen.getByText('Manage billing via Stripe')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open billing portal' }));

    await waitFor(() => {
      expect(mockCreatePortalSession).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(window.location.href).toBe('https://billing.stripe.com/portal');
    });
  });

  it('alerts when Stripe portal redirection is rejected due to untrusted URL', async () => {
    const { logger } = await import('../lib/logger');
    const loggerWarnSpy = vi.spyOn(logger, 'warn');

    mockCreatePortalSession.mockResolvedValue(okResult({ url: 'https://evil.example/steal' }));

    renderBillingPreferencesPage();

    fireEvent.click(screen.getByRole('button', { name: 'Open billing portal' }));

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
      error: { kind: 'server', message: 'Portal disabled', status: 403 },
    });

    renderBillingPreferencesPage();

    fireEvent.click(screen.getByRole('button', { name: 'Open billing portal' }));

    await waitFor(() => {
      expect(mockShowAlert).toHaveBeenCalledWith('Failed to open billing portal: Portal disabled');
    });
  });
});
