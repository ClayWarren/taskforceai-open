import { getMobileClient } from './client';

export const setupAuthenticatorMFA = async () => getMobileClient().setupAuthenticatorMFA();

export const verifyAuthenticatorMFA = async (code: string) =>
  getMobileClient().verifyAuthenticatorMFA(code);

export const disableAuthenticatorMFA = async (code: string) =>
  getMobileClient().disableAuthenticatorMFA(code);
