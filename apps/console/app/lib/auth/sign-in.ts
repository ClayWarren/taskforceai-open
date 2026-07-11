import { authClient } from '@taskforceai/api-client/auth/auth-client';

export const getConsoleSignInUrl = (callbackUrl: string): string => {
  return authClient.getSignInUrl({ callbackUrl });
};
