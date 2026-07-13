import { describe, expect, it } from 'bun:test';

import {
  activeTasksResponseSchema,
  authenticatedUserSchema,
  balanceResponseSchema,
  invoiceResponseSchema,
  paymentMethodResponseSchema,
  runRequestSchema,
  subscriptionResponseSchema,
} from './contracts';

const authenticatedUserPayload = {
  cancel_at_period_end: false,
  code_execution_enabled: true,
  current_period_end: null,
  current_period_start: null,
  customer_id: null,
  disabled: 'false',
  email: 'user@example.com',
  id: 1,
  is_admin: false,
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
};

describe('contracts-ts/contracts billing timestamp normalization', () => {
  it('normalizes null active task lists to an empty array', () => {
    const parsed = activeTasksResponseSchema.parse({
      tasks: null,
    });

    expect(parsed.tasks).toEqual([]);
  });

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

  it('normalizes mixed payment method field casing', () => {
    expect(
      paymentMethodResponseSchema.parse({
        id: 'pm_1',
        brand: 'visa',
        last4: '4242',
        exp_month: 12,
        expYear: 2030,
        is_default: true,
      })
    ).toMatchObject({ expMonth: 12, expYear: 2030, isDefault: true });
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

  it('normalizes Date object timestamps to unix seconds', () => {
    const source = new Date('2026-03-03T12:00:00Z');
    const parsed = balanceResponseSchema.parse({
      credit_balance: 42,
      auto_recharge_enabled: true,
      cancel_at_period_end: false,
      current_period_end: source,
      current_period_start: null,
    });

    expect(parsed.currentPeriodEnd).toBe(Math.trunc(source.getTime() / 1000));
  });

  it('accepts numeric authenticated user billing periods from production payloads', () => {
    const sourceSeconds = Math.trunc(Date.parse('2026-03-04T00:00:00Z') / 1000);
    const parsed = authenticatedUserSchema.parse({
      ...authenticatedUserPayload,
      current_period_end: sourceSeconds,
      free_tasks_remaining: 10,
      trial_ends_at: null,
    });

    expect(parsed.current_period_end).toBe('2026-03-04T00:00:00.000Z');
  });

  it('accepts the auth service current-user payload without legacy quota fields', () => {
    const parsed = authenticatedUserSchema.parse({
      ...authenticatedUserPayload,
      full_name: null,
      impersonator_id: undefined,
    });

    expect(parsed.free_tasks_remaining).toBe(0);
    expect(parsed.trial_ends_at).toBe(null);
  });

  it('preserves boolean authenticated user admin payloads', () => {
    const parsed = authenticatedUserSchema.parse({
      ...authenticatedUserPayload,
      email: 'admin@example.com',
      is_admin: true,
    });

    expect(parsed.is_admin).toBe(true);
  });

  it('keeps nullable attachment ids and integer project ids aligned with the API', () => {
    expect(
      runRequestSchema.parse({
        prompt: 'Review this',
        attachment_ids: null,
        projectId: 42,
      })
    ).toMatchObject({ attachment_ids: null, projectId: 42 });

    expect(
      runRequestSchema.safeParse({
        prompt: 'Review this',
        projectId: 1.5,
      }).success
    ).toBe(false);
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
