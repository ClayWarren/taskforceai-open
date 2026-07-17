/**
 * Apple OAuth utilities for mobile app
 */
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

import { createModuleLogger } from '../logger';

const logger = createModuleLogger('AppleOAuth');

export interface AppleAuthResult {
  identityToken: string;
  authorizationCode: string;
  nonce: string;
  email?: string;
  fullName?: string;
}

/**
 * Checks if Apple Sign-In is available on the current device.
 * Typically available on iOS 13+ and not available on Android via native module.
 */
export async function isAppleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  return AppleAuthentication.isAvailableAsync();
}

const randomHex = async (byteCount: number): Promise<string> => {
  const bytes = await Crypto.getRandomBytesAsync(byteCount);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export async function signInWithApple(): Promise<AppleAuthResult> {
  try {
    const nonce = await randomHex(32);
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce,
      state: nonce,
    });

    if (!credential.identityToken || !credential.authorizationCode) {
      throw new Error('Apple Sign-In failed: missing tokens');
    }
    if (credential.state !== nonce) {
      throw new Error('Apple Sign-In failed: state mismatch');
    }

    return {
      identityToken: credential.identityToken,
      authorizationCode: credential.authorizationCode,
      nonce,
      email: credential.email || undefined,
      fullName: credential.fullName?.givenName
        ? `${credential.fullName.givenName} ${credential.fullName.familyName || ''}`.trim()
        : undefined,
    };
  } catch (error: unknown) {
    const errorObj = error as Record<string, unknown> | null;
    if (errorObj?.['code'] === 'ERR_CANCELED' || errorObj?.['code'] === '1001') {
      throw new Error('Sign-In cancelled', { cause: error });
    }
    logger.error('Apple sign-in error', { error });
    throw error;
  }
}
