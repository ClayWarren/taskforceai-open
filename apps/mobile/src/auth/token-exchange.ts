import { z } from 'zod';

import { createModuleLogger } from '../logger';
import { getMobilePinnedFetch } from '../api/client';
import { getMobileBaseUrl } from '../config/base-url';

import { type AuthenticatedUser, authenticatedUserSchema } from '@taskforceai/contracts/contracts';
import { readApiErrorMessage } from '@taskforceai/api-client/api/response';

const logger = createModuleLogger('TokenExchange');

const AuthSuccessResponseSchema = z.object({
  access_token: z.string(),
  user: authenticatedUserSchema.optional(),
});

const AuthMFAResponseSchema = z.object({
  mfa_required: z.literal(true),
  mfa_token: z.string(),
  user: authenticatedUserSchema,
});

const AuthResponseSchema = z.union([AuthSuccessResponseSchema, AuthMFAResponseSchema]);

interface AuthResponse {
  accessToken: string;
  user?: AuthenticatedUser;
}

interface AuthMFARequiredResponse {
  mfaRequired: true;
  mfaToken: string;
  user: AuthenticatedUser;
}

export type AuthExchangeResponse = AuthResponse | AuthMFARequiredResponse;

const providerPath = {
  google: '/api/v1/auth/google',
  apple: '/api/v1/auth/apple',
} as const;

const providerFallbackMessage = {
  google: 'Failed to exchange Google token',
  apple: 'Failed to exchange Apple token',
} as const;

export type GoogleExchangePayload = {
  idToken: string;
  accessToken: string;
};

export type AppleExchangePayload = {
  identityToken: string;
  authorizationCode: string;
  nonce: string;
  email?: string | null;
  fullName?: string | Record<string, unknown> | null;
};

const readAuthResponse = async (
  response: Response,
  provider: keyof typeof providerPath
): Promise<z.infer<typeof AuthResponseSchema>> => {
  let rawAuthData: unknown;
  try {
    rawAuthData = await response.json();
  } catch (error) {
    logger.error(`${provider} exchange returned invalid JSON`, { error });
    throw new Error(`Invalid response from ${provider} token exchange`, { cause: error });
  }

  const parsed = AuthResponseSchema.safeParse(rawAuthData);
  if (!parsed.success) {
    logger.error(`${provider} exchange returned invalid payload`, {
      error: parsed.error.flatten(),
    });
    throw new Error(`Invalid response from ${provider} token exchange`);
  }
  return parsed.data;
};

const exchangeToken = async (
  provider: keyof typeof providerPath,
  payload: Record<string, unknown>
): Promise<AuthExchangeResponse> => {
  const pinnedFetch = getMobilePinnedFetch();
  logger.info(`Exchanging ${provider} token`, {
    url: `${getMobileBaseUrl()}${providerPath[provider]}`,
  });

  let response;
  try {
    response = await pinnedFetch(`${getMobileBaseUrl()}${providerPath[provider]}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'TaskForceAI-Mobile',
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    logger.error(`Networking error during ${provider} exchange`, { error });
    throw error;
  }

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(`${provider} exchange failed`, {
      status: response.status,
      body: errorBody,
    });
    let errorMessage = `${providerFallbackMessage[provider]} (${response.status})`;
    try {
      errorMessage = readApiErrorMessage(JSON.parse(errorBody)) ?? errorMessage;
    } catch {
      // Keep fallback message if JSON parsing fails
    }
    throw new Error(errorMessage);
  }

  const authData = await readAuthResponse(response, provider);
  if ('mfa_required' in authData) {
    return {
      mfaRequired: true,
      mfaToken: authData.mfa_token,
      user: authData.user,
    };
  }
  return {
    accessToken: authData.access_token,
    user: authData.user,
  };
};

export const exchangeGoogleToken = (payload: GoogleExchangePayload): Promise<AuthExchangeResponse> =>
  exchangeToken('google', payload);

export const exchangeAppleToken = (payload: AppleExchangePayload): Promise<AuthExchangeResponse> =>
  exchangeToken('apple', payload);
