import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../tests/setup/dom';

const mockReplace = vi.fn();
const mockStartUpgradeCheckout = vi.fn();
let mockSearchParams = new URLSearchParams();
let mockAuthState: { isAuthenticated: boolean; sessionStatus: string } = {
  isAuthenticated: true,
  sessionStatus: 'authenticated',
};

vi.mock('../../components/routing', () => ({
  useRouter: vi.fn(() => ({ replace: mockReplace })),
  useSearchParams: vi.fn(() => mockSearchParams),
}));

vi.mock('../providers/AuthProvider', () => ({
  useAuth: vi.fn(() => mockAuthState),
}));

vi.mock('@taskforceai/api-client/services/upgrade-flow', () => ({
  startUpgradeCheckout: mockStartUpgradeCheckout,
}));

vi.mock('../logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { logger } from '../logger';
import { startUpgradeCheckout } from '@taskforceai/api-client/services/upgrade-flow';
import { usePlanCheckout } from './usePlanCheckout';

const flushEffects = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe('usePlanCheckout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
    mockAuthState = { isAuthenticated: true, sessionStatus: 'authenticated' };
    window.history.replaceState({}, '', '/chat');
  });

  it('does not start checkout when plan parameter is invalid', async () => {
    mockSearchParams = new URLSearchParams('plan=enterprise');
    renderHook(() => usePlanCheckout());

    await flushEffects();

    expect(startUpgradeCheckout).not.toHaveBeenCalled();
  });

  it('does not start checkout when user is not authenticated', async () => {
    mockSearchParams = new URLSearchParams('plan=pro');
    mockAuthState = { isAuthenticated: false, sessionStatus: 'unauthenticated' };
    renderHook(() => usePlanCheckout());

    await flushEffects();

    expect(startUpgradeCheckout).not.toHaveBeenCalled();
  });

  it('starts checkout and redirects for a valid plan', async () => {
    mockSearchParams = new URLSearchParams('plan=pro');
    window.history.replaceState({}, '', '/chat?plan=pro&source=login');
    const assignSpy = vi.spyOn(window.location, 'assign').mockImplementation(() => {});

    mockStartUpgradeCheckout.mockResolvedValue({
      ok: true,
      value: { checkoutUrl: 'https://checkout.stripe.com/test-pro' },
    });

    renderHook(() => usePlanCheckout());

    await waitFor(() => {
      expect(startUpgradeCheckout).toHaveBeenCalledWith({ targetPlan: 'pro' });
    });

    expect(assignSpy).toHaveBeenCalledWith('https://checkout.stripe.com/test-pro');
    expect(mockReplace).not.toHaveBeenCalled();

    assignSpy.mockRestore();
  });

  it('cleans up the plan query parameter when checkout returns failure', async () => {
    mockSearchParams = new URLSearchParams('plan=super');
    window.history.replaceState({}, '', '/chat?plan=super&source=login');

    mockStartUpgradeCheckout.mockResolvedValue({
      ok: false,
      error: { kind: 'checkout', message: 'Stripe unavailable' },
    });

    renderHook(() => usePlanCheckout());

    await waitFor(() => {
      expect(startUpgradeCheckout).toHaveBeenCalledWith({ targetPlan: 'super' });
    });

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalled();
    });
    const replaceTarget = mockReplace.mock.calls[0]?.[0];
    expect(typeof replaceTarget).toBe('string');
    expect(replaceTarget).not.toContain('plan=');
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to start checkout',
      expect.objectContaining({ plan: 'super' })
    );
  });

  it('cleans up the plan query parameter when checkout throws', async () => {
    mockSearchParams = new URLSearchParams('plan=super');
    window.history.replaceState({}, '', '/chat?plan=super&source=login');
    mockStartUpgradeCheckout.mockRejectedValue(new Error('Network error'));

    renderHook(() => usePlanCheckout());

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalled();
    });
    const replaceTarget = mockReplace.mock.calls[0]?.[0];
    expect(typeof replaceTarget).toBe('string');
    expect(replaceTarget).not.toContain('plan=');
    expect(logger.error).toHaveBeenCalledWith(
      'Checkout error',
      expect.objectContaining({ plan: 'super' })
    );
  });
});
