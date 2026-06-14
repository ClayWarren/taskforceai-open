import { describe, expect, it } from 'bun:test';

import {
  buildProfileUpgradeOptions,
  formatProfileCreditBalanceLabel,
  formatProfilePlanLabel,
  formatProfilePriceLabel,
  formatProfileUsageResetLabel,
  formatSubscriptionSourceLabel,
  inferDisplayNameFromEmail,
  normalizeProfileFullName,
  normalizeProfilePlan,
  resolveProfileDisplayName,
  resolveProfileHandle,
  resolveProfileInitials,
  resolveProfileMessageUsageLabel,
  resolveProfilePlanPriceLabels,
} from './view-model';

describe('profile view model helpers', () => {
  it('normalizes identity display values', () => {
    expect(normalizeProfileFullName('  Clay Warren  ')).toBe('Clay Warren');
    expect(inferDisplayNameFromEmail('clay.warren@example.com')).toBe('Clay Warren');
    expect(resolveProfileDisplayName({ email: 'jane-doe@example.com' })).toBe('Jane Doe');
    expect(resolveProfileInitials({ fullName: 'Clay Warren' })).toBe('CW');
    expect(resolveProfileInitials({ email: 'clay@example.com' })).toBe('C');
    expect(resolveProfileHandle('clay@example.com')).toBe('@clay');
  });

  it('normalizes plan and usage labels', () => {
    expect(normalizeProfilePlan('enterprise')).toBe('free');
    expect(formatProfilePlanLabel('super')).toBe('Super');
    expect(resolveProfileMessageUsageLabel({ plan: 'free', messageCount: 0 })).toBe(
      '0 used · 1 remaining this week'
    );
    expect(resolveProfileMessageUsageLabel({ plan: 'pro', messageCount: 100 })).toBe(
      '100 used · 2 per hour'
    );
    expect(resolveProfileMessageUsageLabel({ plan: 'super', messageCount: 100 })).toBe(
      '100 used · 20 per hour'
    );
  });

  it('formats profile usage billing labels', () => {
    expect(formatProfileCreditBalanceLabel(42.5)).toBe('$42.50');
    expect(formatProfileCreditBalanceLabel(null)).toBeNull();
    expect(formatProfileUsageResetLabel({ currentPeriodEnd: '2025-01-01T12:00:00.000Z' })).toBe(
      'Resets Jan 1, 2025'
    );
    expect(formatProfileUsageResetLabel(null)).toBeNull();
  });

  it('builds upgrade options from product summaries', () => {
    expect(
      buildProfileUpgradeOptions({
        currentPlan: 'free',
        products: [
          { plan: 'pro', price_id: 'price-pro', price_amount: 2800 },
          { id: 'taskforce-super', price_id: 'price-super', price_amount: 28000 },
        ],
      })
    ).toEqual([
      {
        plan: 'pro',
        price_id: 'price-pro',
        price_amount: 2800,
        price_currency: 'USD',
      },
      {
        plan: 'super',
        price_id: 'price-super',
        price_amount: 28000,
        price_currency: 'USD',
      },
    ]);
    expect(buildProfileUpgradeOptions({ currentPlan: 'super', products: [] })).toEqual([]);
  });

  it('formats prices and subscription sources', () => {
    expect(formatProfilePriceLabel({ plan: 'pro', amount: 1234 })).toBe('$12.34 / month');
    expect(formatProfilePriceLabel({ plan: 'super', amount: null })).toBe('$280.00 / month');
    expect(formatSubscriptionSourceLabel('stripe')).toBe('Stripe (Web/Desktop)');
    expect(formatSubscriptionSourceLabel('app_store')).toBe('Apple App Store');
    expect(formatSubscriptionSourceLabel(null, { fallback: 'N/A' })).toBe('N/A');
    expect(formatSubscriptionSourceLabel('custom_provider')).toBeNull();
  });

  it('resolves profile plan price labels from products', () => {
    expect(
      resolveProfilePlanPriceLabels(
        [
          { id: 'taskforce-pro', price_amount: 2800, price_currency: 'USD' },
          { plan: 'super', price_amount: 28000, price_currency: 'USD' },
        ],
        (amount, currency) => `${currency} ${amount}`
      )
    ).toEqual({
      proPriceLabel: 'USD 2800',
      superPriceLabel: 'USD 28000',
    });

    expect(resolveProfilePlanPriceLabels([])).toEqual({
      proPriceLabel: null,
      superPriceLabel: null,
    });
  });
});
