import { authClient } from '@taskforceai/api-client/auth/auth-client';

export const getWebAuthSession = () => authClient.getSession();
