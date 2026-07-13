import { buildUserState as buildApiUserState } from '@taskforceai/api-client/auth/auth-service';

export type MobileUserState = ReturnType<typeof buildApiUserState>;

export const buildMobileUserState = (
  overrides: Parameters<typeof buildApiUserState>[0]
): MobileUserState => buildApiUserState(overrides);
