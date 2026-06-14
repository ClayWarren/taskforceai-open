/**
 * Google OAuth utilities for mobile app
 */
import * as AuthSession from 'expo-auth-session';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { z } from 'zod';

import { requireGoogleClientId, getGoogleAndroidClientId } from '../config/env';
import { createModuleLogger } from '../logger';

// Configure Google OAuth
const discovery = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://www.googleapis.com/oauth2/v4/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
};

// Returns the reverse-DNS scheme for a Google OAuth client ID.
// e.g. "40158904703-abc.apps.googleusercontent.com" → "com.googleusercontent.apps.40158904703-abc"
const googleClientIdToScheme = (clientId: string) =>
  `com.googleusercontent.apps.${clientId.replace('.apps.googleusercontent.com', '')}`;

// Pick the platform-specific client ID and its matching redirect URI.
// Native (iOS/Android) clients must use the reverse-DNS scheme redirect;
// Google blocks custom schemes like taskforceai:// for web client IDs.
const getClientConfig = (): { clientId: string; redirectUri: string } => {
  const androidClientId = getGoogleAndroidClientId();
  if (Platform.OS === 'android' && androidClientId) {
    return {
      clientId: androidClientId,
      redirectUri: AuthSession.makeRedirectUri({
        native: `${googleClientIdToScheme(androidClientId)}:/oauth2redirect`,
      }),
    };
  }
  // iOS — falls back to the configured client ID (create an iOS-type OAuth
  // client in Google Cloud Console and set EXPO_PUBLIC_GOOGLE_CLIENT_ID to it
  // to resolve the same policy error on iOS).
  const clientId = requireGoogleClientId();
  return {
    clientId,
    redirectUri: AuthSession.makeRedirectUri({
      native: `${googleClientIdToScheme(clientId)}:/oauth2redirect`,
    }),
  };
};

WebBrowser.maybeCompleteAuthSession();
const logger = createModuleLogger('GoogleOAuth');

const GoogleUserInfoSchema = z.object({
  email: z.string(),
  name: z.string().optional(),
  picture: z.string().optional(),
}).passthrough();

export interface GoogleAuthResult {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  user: {
    email: string;
    name?: string;
    picture?: string;
  };
}

export async function signInWithGoogle(): Promise<GoogleAuthResult> {
  try {
    const { clientId, redirectUri } = getClientConfig();
    // Generate a random state value for security
    const state = await Crypto.getRandomBytesAsync(16).then((bytes) =>
      Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    );

    // Create the auth request
    const request = new AuthSession.AuthRequest({
      clientId,
      redirectUri,
      responseType: AuthSession.ResponseType.Code,
      scopes: ['openid', 'profile', 'email'],
      state,
      extraParams: {
        access_type: 'offline', // Get refresh token
        prompt: 'consent',
      },
    });

    // Start the auth flow
    const promptResult = await request.promptAsync(discovery);

    if (promptResult.type === 'success') {
      if (promptResult.params['state'] !== state) {
        throw new Error('Google sign-in failed: state mismatch');
      }

      // Exchange the authorization code for tokens
      const tokenResponse = await AuthSession.exchangeCodeAsync(
        {
          clientId,
          redirectUri,
          code: promptResult.params['code'] || '',
          extraParams: {
            code_verifier: request.codeVerifier || '',
          },
        },
        discovery
      );

      // Get user info with the access token
      const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: {
          Authorization: `Bearer ${tokenResponse.accessToken}`,
        },
      });

      if (!userInfoResponse.ok) {
        throw new Error('Failed to fetch user info');
      }

      const rawUserInfo: unknown = await userInfoResponse.json();
      const userInfo = GoogleUserInfoSchema.parse(rawUserInfo);

      if (!tokenResponse.accessToken || !userInfo.email) {
        throw new Error('Missing required tokens or user info');
      }

      const result: GoogleAuthResult = {
        accessToken: tokenResponse.accessToken,
        user: {
          email: userInfo.email,
          name: userInfo.name ?? '',
          picture: userInfo.picture ?? '',
        },
      };
      if (tokenResponse.refreshToken) result.refreshToken = tokenResponse.refreshToken;
      if (tokenResponse.idToken) result.idToken = tokenResponse.idToken;

      return result;
    } else {
      throw new Error('Authentication cancelled or failed');
    }
  } catch (error) {
    logger.error('Google sign-in error', { error });
    throw error;
  }
}
