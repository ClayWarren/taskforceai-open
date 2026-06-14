import { describe, expect, it } from 'bun:test';

import {
  authenticatedUserSchema,
  balanceResponseSchema,
  invoiceResponseSchema,
  subscriptionResponseSchema,
} from './contracts';

describe('contracts-ts/contracts billing timestamp normalization', () => {
  it('normalizes millisecond numeric timestamps to unix seconds', () => {
    const source = Date.parse('2026-03-01T00:00:00Z');
    const parsed = balanceResponseSchema.parse({
      credit_balance: 100,
      auto_recharge_enabled: false,
      cancel_at_period_end: false,
      current_period_end: source,
      current_period_start: null,
    });

    expect(parsed.currentPeriodEnd).toBe(Math.trunc(source / 1000));
  });

  it('normalizes millisecond numeric-string timestamps to unix seconds', () => {
    const source = Date.parse('2026-03-02T00:00:00Z');
    const parsed = invoiceResponseSchema.parse({
      id: 'inv_1',
      number: 'INV-1',
      amount_paid: 12.5,
      currency: 'usd',
      status: 'paid',
      created_at: String(source),
      invoice_pdf: 'https://billing.example.com/invoice.pdf',
      hosted_url: 'https://billing.example.com/invoice',
    });

    expect(parsed.createdAt).toBe(Math.trunc(source / 1000));
  });

  it('preserves unix-second numeric timestamps as seconds', () => {
    const sourceSeconds = Math.trunc(Date.parse('2026-03-03T00:00:00Z') / 1000);
    const parsed = balanceResponseSchema.parse({
      credit_balance: 42,
      auto_recharge_enabled: true,
      cancel_at_period_end: false,
      current_period_end: sourceSeconds,
      current_period_start: null,
    });

    expect(parsed.currentPeriodEnd).toBe(sourceSeconds);
  });

  it('accepts numeric authenticated user billing periods from production payloads', () => {
    const sourceSeconds = Math.trunc(Date.parse('2026-03-04T00:00:00Z') / 1000);
    const parsed = authenticatedUserSchema.parse({
      cancel_at_period_end: false,
      code_execution_enabled: true,
      current_period_end: sourceSeconds,
      current_period_start: null,
      customer_id: null,
      disabled: 'false',
      email: 'user@example.com',
      free_tasks_remaining: 10,
      id: 1,
      is_admin: 'false',
      last_message_timestamp: null,
      memory_enabled: true,
      message_count: 0,
      notifications_enabled: true,
      plan: 'free',
      quick_mode_enabled: true,
      subscription_id: null,
      subscription_source: null,
      subscription_status: null,
      theme_preference: 'dark',
      trial_ends_at: null,
      trust_layer_enabled: false,
      web_search_enabled: true,
    });

    expect(parsed.current_period_end).toBe('2026-03-04T00:00:00.000Z');
  });

  it('accepts the auth service current-user payload without legacy quota fields', () => {
    const parsed = authenticatedUserSchema.parse({
      cancel_at_period_end: false,
      code_execution_enabled: true,
      current_period_end: null,
      current_period_start: null,
      customer_id: null,
      disabled: 'false',
      email: 'user@example.com',
      full_name: null,
      id: 1,
      impersonator_id: undefined,
      is_admin: 'false',
      last_message_timestamp: null,
      memory_enabled: true,
      message_count: 0,
      notifications_enabled: true,
      plan: 'free',
      quick_mode_enabled: true,
      subscription_id: null,
      subscription_source: null,
      subscription_status: null,
      theme_preference: 'dark',
      trust_layer_enabled: false,
      web_search_enabled: true,
    });

    expect(parsed.free_tasks_remaining).toBe(0);
    expect(parsed.trial_ends_at).toBe(null);
  });

  it('normalizes boolean authenticated user admin payloads', () => {
    const parsed = authenticatedUserSchema.parse({
      cancel_at_period_end: false,
      code_execution_enabled: true,
      current_period_end: null,
      current_period_start: null,
      customer_id: null,
      disabled: 'false',
      email: 'admin@example.com',
      id: 1,
      is_admin: true,
      last_message_timestamp: null,
      memory_enabled: true,
      message_count: 0,
      notifications_enabled: true,
      plan: 'free',
      quick_mode_enabled: true,
      subscription_id: null,
      subscription_source: null,
      subscription_status: null,
      theme_preference: 'dark',
      trust_layer_enabled: false,
      web_search_enabled: true,
    });

    expect(parsed.is_admin).toBe('true');
  });

  it('accepts ISO string subscription periods from production payloads', () => {
    const parsed = subscriptionResponseSchema.parse({
      subscription: {
        subscription_id: 'sub_1',
        status: 'active',
        current_period_start: '2026-03-01T00:00:00Z',
        current_period_end: '2026-04-01T00:00:00Z',
        cancel_at_period_end: false,
      },
    });

    expect(parsed.subscription?.current_period_start).toBe(
      Math.trunc(Date.parse('2026-03-01T00:00:00Z') / 1000)
    );
  });
});
