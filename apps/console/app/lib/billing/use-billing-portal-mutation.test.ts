import { beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../tests/setup/dom';

const mockUseMutation = vi.fn();
const mockCreatePortalSession = vi.fn();
const mockLoggerError = vi.fn();
const mockLoggerWarn = vi.fn();
const mockShowAlert = vi.fn();

type MutationOptions<TResult = unknown> = {
  mutationFn: () => TResult | Promise<TResult>;
  onSuccess?: (result: TResult) => void;
  onError?: (error: unknown) => void;
};

vi.mock('@tanstack/react-query', () => ({
  useMutation: (options: MutationOptions) => mockUseMutation(options),
}));

vi.mock('@taskforceai/api-client/api/billing', () => ({
  createPortalSession: mockCreatePortalSession,
}));

vi.mock('../logger', () => ({
  logger: {
    error: mockLoggerError,
    warn: mockLoggerWarn,
  },
}));

vi.mock('@taskforceai/browser-runtime/browser-actions', () => ({
  showAlert: mockShowAlert,
}));

import { useBillingPortalMutation } from './use-billing-portal-mutation';

const useMutationOptions = <TResult>() => {
  useBillingPortalMutation();
  const options = mockUseMutation.mock.calls.at(-1)?.[0] as MutationOptions<TResult> | undefined;
  if (!options) {
    throw new Error('Expected useMutation options');
  }
  return options;
};

describe('useBillingPortalMutation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseMutation.mockImplementation((options: MutationOptions) => options);
    mockCreatePortalSession.mockResolvedValue({
      ok: true,
      value: { url: 'https://billing.stripe.com/portal' },
    });
    mockShowAlert.mockReturnValue({ ok: true, value: undefined });
    window.location.href = 'http://localhost/';
  });

  it('creates a billing portal session from the mutation function', async () => {
    const options = useMutationOptions();

    await expect(options.mutationFn()).resolves.toEqual({
      ok: true,
      value: { url: 'https://billing.stripe.com/portal' },
    });

    expect(mockCreatePortalSession).toHaveBeenCalledTimes(1);
  });

  it('alerts when the portal session succeeds without a redirect URL', () => {
    const options = useMutationOptions<{ ok: true; value: { url?: string | null } }>();

    options.onSuccess?.({ ok: true, value: { url: null } });

    expect(mockShowAlert).toHaveBeenCalledWith(
      'Failed to open billing portal: missing redirect URL.'
    );
    expect(window.location.href).toBe('http://localhost/');
  });

  it('logs when the user alert cannot be shown', () => {
    const alertError = new Error('alert blocked');
    mockShowAlert.mockReturnValue({ ok: false, error: alertError });
    const options = useMutationOptions<{ ok: false; error: { message: string } }>();

    options.onSuccess?.({ ok: false, error: { message: 'Portal disabled' } });

    expect(mockShowAlert).toHaveBeenCalledWith('Failed to open billing portal: Portal disabled');
    expect(mockLoggerWarn).toHaveBeenCalledWith('Failed to show billing alert', {
      error: alertError,
    });
  });

  it('logs mutation failures and alerts the user', () => {
    const error = new Error('network unavailable');
    const options = useMutationOptions();

    options.onError?.(error);

    expect(mockLoggerError).toHaveBeenCalledWith('Failed to create billing portal session', {
      error,
    });
    expect(mockShowAlert).toHaveBeenCalledWith('Failed to open billing portal. Please try again.');
  });
});
