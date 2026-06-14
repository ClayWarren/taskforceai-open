import type { AuthenticatedUser, ConversationSummary } from './contracts';

/**
 * Shared mock factories for API-level contracts.
 * Use these to ensure tests validate against real backend data structures.
 */

export const createMockUser = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => {
  return {
    id: 1,
    email: 'test@taskforceai.chat',
    full_name: 'Test User',
    plan: 'pro',
    message_count: 0,
    free_tasks_remaining: 0,
    last_message_timestamp: null,
    subscription_id: 'sub_123',
    subscription_status: 'active',
    subscription_source: 'stripe',
    current_period_start: new Date().toISOString(),
    current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    cancel_at_period_end: false,
    theme_preference: 'dark',
    memory_enabled: true,
    web_search_enabled: true,
    code_execution_enabled: true,
    notifications_enabled: true,
    trust_layer_enabled: true,
    quick_mode_enabled: false,
    customer_id: 'cus_123',
    disabled: 'false',
    is_admin: 'false',
    trial_ends_at: null,
    ...overrides,
    mfa_enabled: overrides.mfa_enabled ?? false,
  };
};

export const MOCK_USER = createMockUser();

export const createMockConversationSummary = (
  overrides: Partial<ConversationSummary> = {}
): ConversationSummary => {
  return {
    id: 1,
    timestamp: new Date().toISOString(),
    user_input: 'Initial prompt',
    result: 'AI response preview',
    execution_time: 1.5,
    model: 'gpt-4',
    agent_count: 1,
    isPublic: false,
    ...overrides,
  };
};

export const MOCK_CONVERSATION_SUMMARY = createMockConversationSummary();
