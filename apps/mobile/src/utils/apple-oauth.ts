/**
 * Apple OAuth utilities for mobile app
 */
import * as AppleAuthentication from 'expo-apple-authentication';
import { Platform } from 'react-native';

import { createModuleLogger } from '../logger';

const logger = createModuleLogger('AppleOAuth');

export interface AppleAuthResult {
  identityToken: string;
  authorizationCode: string;
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

export async function signInWithApple(): Promise<AppleAuthResult> {
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });

    if (!credential.identityToken || !credential.authorizationCode) {
      throw new Error('Apple Sign-In failed: missing tokens');
    }

    return {
      identityToken: credential.identityToken,
      authorizationCode: credential.authorizationCode,
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
