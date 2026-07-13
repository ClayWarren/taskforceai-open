import { resolveSessionExpiryMs } from '@taskforceai/api-client/auth/session-expiry';

import { createModuleLogger } from '../logger';
import { sqliteStorage } from '../storage/sqlite-adapter';
import type { MobileUserState } from './user-state';

const logger = createModuleLogger('AuthSessionStore');

export const persistAuthenticatedSession = async ({
  accessToken,
  userProfile,
}: {
  accessToken: string;
  userProfile: MobileUserState;
}): Promise<void> => {
  const sessionExpiry = resolveSessionExpiryMs(accessToken);
  const sessionResult = await sqliteStorage.setSession({
    accessToken,
    expiresAt: sessionExpiry,
    user: { id: userProfile.id, email: userProfile.email, plan: userProfile.plan },
  });

  if (!sessionResult.ok) {
    logger.error('Failed to save mobile auth session', { error: sessionResult.error });
    throw new Error('Failed to save session. Please try again.', { cause: sessionResult.error });
  }

  const profileResult = await sqliteStorage.saveProfile(userProfile);
  if (!profileResult.ok) {
    logger.error('Failed to save mobile auth profile', { error: profileResult.error });
    throw new Error('Failed to save profile. Please try again.', { cause: profileResult.error });
  }
};
