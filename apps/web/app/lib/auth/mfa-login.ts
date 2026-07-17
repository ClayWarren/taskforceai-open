import { getBrowserClient } from '@taskforceai/api-client/browserClient';

export const verifyWebAuthenticatorMFALogin = async (code: string, mfaToken: string | undefined) =>
  getBrowserClient().verifyAuthenticatorMFALogin(code, mfaToken);
