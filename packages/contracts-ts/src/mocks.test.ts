import { describe, expect, it } from 'bun:test';

import {
  MOCK_CONVERSATION_SUMMARY,
  MOCK_USER,
  createMockConversationSummary,
  createMockUser,
} from './mocks';

describe('contracts mocks', () => {
  it('creates authenticated users with contract defaults and overrides', () => {
    const user = createMockUser({ email: 'override@example.com', mfa_enabled: true });

    expect(user).toMatchObject({
      id: 1,
      email: 'override@example.com',
      plan: 'pro',
      subscription_status: 'active',
      theme_preference: 'dark',
      memory_enabled: true,
      mfa_enabled: true,
    });
    expect(Date.parse(user.current_period_start ?? '')).not.toBeNaN();
    expect(Date.parse(user.current_period_end ?? '')).not.toBeNaN();
  });

  it('defaults mfa_enabled after applying other user overrides', () => {
    expect(createMockUser().mfa_enabled).toBe(false);
    expect(createMockUser({ full_name: 'Override' }).mfa_enabled).toBe(false);
    expect(MOCK_USER.mfa_enabled).toBe(false);
  });

  it('creates conversation summaries with contract defaults and overrides', () => {
    const summary = createMockConversationSummary({
      id: 42,
      user_input: 'Custom prompt',
      isPublic: true,
    });

    expect(summary).toMatchObject({
      id: 42,
      user_input: 'Custom prompt',
      result: 'AI response preview',
      model: 'gpt-4',
      agent_count: 1,
      isPublic: true,
    });
    expect(Date.parse(summary.timestamp)).not.toBeNaN();
    expect(MOCK_CONVERSATION_SUMMARY.isPublic).toBe(false);
  });
});
