import { getMobileClient } from '../api/client';

export const verifyAuthenticatorMFALogin = async (code: string, mfaToken: string) => {
  return getMobileClient().verifyAuthenticatorMFALogin(code, mfaToken);
};
