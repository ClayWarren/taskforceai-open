import type { AuthenticatedUser } from '@taskforceai/contracts/contracts';

import { type AccountError, fetchCurrentUser } from '@taskforceai/contracts/api/account';
import { type Result, err, ok } from '@taskforceai/shared/result';

export const buildUserState = (overrides: Partial<AuthenticatedUser>): AuthenticatedUser => {
  return {
    id: 0,
    email: '',
    full_name: null,
    plan: 'free',
    message_count: 0,
    free_tasks_remaining: 0,
    last_message_timestamp: null,
    subscription_id: null,
    subscription_status: null,
    subscription_source: null,
    current_period_start: null,
    current_period_end: null,
    cancel_at_period_end: false,
    theme_preference: 'dark',
    customer_id: null,
    disabled: 'false',
    is_admin: 'false',
    impersonator_id: undefined,
    trial_ends_at: null,
    ...overrides,
    memory_enabled: overrides.memory_enabled ?? true,
    web_search_enabled: overrides.web_search_enabled ?? true,
    code_execution_enabled: overrides.code_execution_enabled ?? true,
    notifications_enabled: overrides.notifications_enabled ?? true,
    trust_layer_enabled: overrides.trust_layer_enabled ?? false,
    quick_mode_enabled: overrides.quick_mode_enabled ?? false,
    mfa_enabled: overrides.mfa_enabled ?? false,
  } satisfies AuthenticatedUser;
};

export const loadUserProfile = async (): Promise<Result<AuthenticatedUser, AccountError>> => {
  const result = await fetchCurrentUser();
  if (!result.ok) {
    return err(result.error);
  }
  return ok(buildUserState(result.value));
};
