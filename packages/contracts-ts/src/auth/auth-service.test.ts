import { describe, expect, it } from 'bun:test';
import { buildUserState } from './auth-service';

describe('buildUserState', () => {
  it('returns default user when no overrides', () => {
    const user = buildUserState({});
    expect(user.id).toBe(0);
    expect(user.email).toBe('');
    expect(user.full_name).toBe(null);
    expect(user.plan).toBe('free');
    expect(user.message_count).toBe(0);
    expect(user.last_message_timestamp).toBe(null);
    expect(user.subscription_id).toBe(null);
    expect(user.subscription_status).toBe(null);
    expect(user.subscription_source).toBe(null);
    expect(user.current_period_start).toBe(null);
    expect(user.current_period_end).toBe(null);
    expect(user.cancel_at_period_end).toBe(false);
    expect(user.theme_preference).toBe('dark');
    expect(user.customer_id).toBe(null);
    expect(user.disabled).toBe('false');
    expect(user.is_admin).toBe('false');
    expect(user.impersonator_id).toBe(undefined);
  });

  it('applies overrides', () => {
    const user = buildUserState({
      id: 123,
      email: 'test@example.com',
      full_name: 'Test User',
      plan: 'pro',
      message_count: 50,
    });
    expect(user.id).toBe(123);
    expect(user.email).toBe('test@example.com');
    expect(user.full_name).toBe('Test User');
    expect(user.plan).toBe('pro');
    expect(user.message_count).toBe(50);
  });

  it('sets default feature flags', () => {
    const user = buildUserState({});
    expect(user.memory_enabled).toBe(true);
    expect(user.web_search_enabled).toBe(true);
    expect(user.code_execution_enabled).toBe(true);
    expect(user.notifications_enabled).toBe(true);
    expect(user.trust_layer_enabled).toBe(false);
    expect(user.quick_mode_enabled).toBe(false);
  });

  it('allows overriding feature flags', () => {
    const user = buildUserState({
      memory_enabled: false,
      web_search_enabled: false,
      trust_layer_enabled: true,
      quick_mode_enabled: true,
    });
    expect(user.memory_enabled).toBe(false);
    expect(user.web_search_enabled).toBe(false);
    expect(user.trust_layer_enabled).toBe(true);
    expect(user.quick_mode_enabled).toBe(true);
  });

  it('preserves null values from overrides', () => {
    const user = buildUserState({
      full_name: null,
      subscription_id: null,
    });
    expect(user.full_name).toBe(null);
    expect(user.subscription_id).toBe(null);
  });

  it('handles subscription fields', () => {
    const user = buildUserState({
      subscription_id: 'sub_123',
      subscription_status: 'active',
      subscription_source: 'stripe',
      current_period_start: '2026-01-01T00:00:00.000Z',
      current_period_end: '2026-06-01T00:00:00.000Z',
      cancel_at_period_end: true,
      customer_id: 'cus_123',
    });
    expect(user.subscription_id).toBe('sub_123');
    expect(user.subscription_status).toBe('active');
    expect(user.subscription_source).toBe('stripe');
    expect(user.current_period_start).toBe('2026-01-01T00:00:00.000Z');
    expect(user.current_period_end).toBe('2026-06-01T00:00:00.000Z');
    expect(user.cancel_at_period_end).toBe(true);
    expect(user.customer_id).toBe('cus_123');
  });

  it('handles admin and disabled flags', () => {
    const adminUser = buildUserState({ is_admin: 'true', disabled: 'false' });
    expect(adminUser.is_admin).toBe('true');
    expect(adminUser.disabled).toBe('false');

    const disabledUser = buildUserState({ is_admin: 'false', disabled: 'true' });
    expect(disabledUser.is_admin).toBe('false');
    expect(disabledUser.disabled).toBe('true');
  });

  it('handles impersonator', () => {
    const user = buildUserState({ impersonator_id: '999' });
    expect(user.impersonator_id).toBe('999');
  });
});
