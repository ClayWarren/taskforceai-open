import { authClient } from '@taskforceai/api-client/auth/auth-client';

export const getSignInUrl = (callbackUrl: string): string => {
  return authClient.getSignInUrl({ callbackUrl });
};
