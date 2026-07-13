import { describe, expect, it } from 'bun:test';

import {
  cancelProfileSubscription,
  clickFoundRole,
  clickFoundText,
  installProfileModalTestHooks,
  mockPaidProfile,
  mockProfileData,
  navigateTo,
  openProfileTab,
  proProduct,
  reactivateProfileSubscription,
  renderOpenProfile,
  screen,
  startUpgradeCheckout,
  waitFor,
} from './ProfileModal.test-harness';

installProfileModalTestHooks();

describe('ProfileModal', () => {
  it('handles upgrade checkout', async () => {
    (startUpgradeCheckout as any).mockResolvedValue({
      ok: true,
      value: { checkoutUrl: 'https://stripe.com' },
    });
    await renderOpenProfile();
    await openProfileTab('Subscription');

    expect(screen.getByText('$20.00 / month')).toBeDefined();

    await clickFoundRole(/Upgrade to pro/i);

    await waitFor(() => expect(startUpgradeCheckout).toHaveBeenCalled());
    expect(navigateTo).toHaveBeenCalledWith('https://stripe.com');
  });

  it('opens the usage settings tab and starts usage upgrade checkout', async () => {
    (startUpgradeCheckout as any).mockResolvedValue({
      ok: true,
      value: { checkoutUrl: 'https://stripe.com/usage' },
    });

    await renderOpenProfile();
    await openProfileTab('Usage');

    expect(screen.getByText('Usage limits')).toBeDefined();
    expect(screen.getByText('0 messages used')).toBeDefined();
    expect(screen.getByText('$20.00 / month')).toBeDefined();

    await clickFoundRole(/Usage upgrade to pro/i);

    await waitFor(() => expect(startUpgradeCheckout).toHaveBeenCalled());
    expect(navigateTo).toHaveBeenCalledWith('https://stripe.com/usage');
  });

  it('handles subscription cancellation', async () => {
    (cancelProfileSubscription as any).mockResolvedValue({
      ok: true,
      value: { message: 'Cancelled' },
    });
    mockPaidProfile();

    await renderOpenProfile();
    await openProfileTab('Subscription');

    await clickFoundText('Cancel Subscription');

    await clickFoundRole('Confirm Cancellation');

    await waitFor(() => expect(cancelProfileSubscription).toHaveBeenCalled());
    expect(screen.getByText('Cancelled')).toBeDefined();
  });

  it('handles upgrade checkout failure', async () => {
    (startUpgradeCheckout as any).mockResolvedValue({
      ok: false,
      error: { message: 'Network error' },
    });
    await renderOpenProfile();
    await openProfileTab('Subscription');

    await clickFoundRole(/Upgrade to pro/i);

    await waitFor(() => expect(startUpgradeCheckout).toHaveBeenCalled());
  });

  it('handles subscription cancellation failure', async () => {
    (cancelProfileSubscription as any).mockResolvedValue({
      ok: false,
      error: { message: 'Server error' },
    });
    mockPaidProfile();

    await renderOpenProfile();
    await openProfileTab('Subscription');

    await clickFoundText('Cancel Subscription');

    await clickFoundRole('Confirm Cancellation');

    await waitFor(() => expect(screen.getByText(/Failed to cancel subscription/i)).toBeDefined());
  });

  it('handles subscription reactivation', async () => {
    (reactivateProfileSubscription as any).mockResolvedValue({
      ok: true,
      value: { message: 'Reactivated' },
    });
    await renderOpenProfile();
    await openProfileTab('Subscription');

    await clickFoundText('Reactivate Subscription');

    await waitFor(() => expect(reactivateProfileSubscription).toHaveBeenCalled());
    expect(screen.getByText('Reactivated')).toBeDefined();
  });

  it('handles reactivation failure', async () => {
    (reactivateProfileSubscription as any).mockResolvedValue({
      ok: false,
      error: { message: 'Error' },
    });
    await renderOpenProfile();
    await openProfileTab('Subscription');

    await clickFoundText('Reactivate Subscription');

    await waitFor(() =>
      expect(screen.getByText(/Failed to reactivate subscription/i)).toBeDefined()
    );
  });

  it('shows error if priceId is missing during upgrade', async () => {
    mockProfileData({
      subscription: null,
      products: [{ ...proProduct, price_id: null }],
    });

    await renderOpenProfile();
    await openProfileTab('Subscription');

    await clickFoundRole(/Upgrade to pro/i);

    await waitFor(() =>
      expect(screen.getByText(/Upgrade link is temporarily unavailable/i)).toBeDefined()
    );
  });

  it('handles navigateTo failure during upgrade', async () => {
    (startUpgradeCheckout as any).mockResolvedValue({
      ok: true,
      value: { checkoutUrl: 'https://failure.com' },
    });
    (navigateTo as any).mockReturnValue({ ok: false, error: { message: 'Nav failed' } });

    await renderOpenProfile();
    await openProfileTab('Subscription');

    await clickFoundRole(/Upgrade to pro/i);

    await waitFor(() => expect(navigateTo).toHaveBeenCalled());
  });
});
