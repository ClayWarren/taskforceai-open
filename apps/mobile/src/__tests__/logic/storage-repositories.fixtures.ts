export const createProfileData = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    subscription_id: null,
    subscription_source: null,
    current_period_start: null,
    cancel_at_period_end: false,
    theme_preference: 'system',
    memory_enabled: true,
    web_search_enabled: true,
    code_execution_enabled: true,
    notifications_enabled: true,
    trust_layer_enabled: true,
    quick_mode_enabled: false,
    customer_id: null,
    disabled: 'false',
    is_admin: 'false',
    ...overrides,
  });

export const createSessionRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  accessToken: 'KEYCHAIN_ONLY',
  expiresAt: Date.now() + 60_000,
  userId: 'user-1',
  email: 'user@example.com',
  plan: 'free',
  createdAt: 1,
  ...overrides,
});

export const createProfileRow = (overrides: Record<string, unknown> = {}) => ({
  id: 101,
  email: 'user@example.com',
  fullName: 'User',
  avatarUrl: null,
  plan: 'free',
  subscriptionStatus: null,
  currentPeriodEnd: null,
  messageCount: 0,
  lastMessageTimestamp: null,
  data: createProfileData(),
  updatedAt: 1,
  ...overrides,
});
