import { getBrowserClient } from '@taskforceai/api-client/browserClient';
import type { AuthenticatedUser } from '@taskforceai/contracts/contracts';
import { getCsrfToken } from '../auth/csrf';

import { getAuthLogger } from '../auth/logger';
import { type Result, err, ok } from '../utils/result';
import { classifyApiError } from './error-utils';

export type AccountError = {
  kind: 'unauthorized' | 'not_found' | 'server' | 'network';
  message: string;
  status?: number;
};

const mapAccountError = (error: unknown, fallbackMessage: string): AccountError => {
  const classified = classifyApiError(error);
  return {
    kind: classified.kind,
    message: fallbackMessage,
    ...(classified.status !== undefined ? { status: classified.status } : {}),
  };
};

const logger = getAuthLogger();

export const fetchCurrentUser = async (
  init: Pick<RequestInit, 'signal'> = {}
): Promise<Result<AuthenticatedUser, AccountError>> => {
  try {
    const client = getBrowserClient({ getCsrfToken });
    const userProfile = await client.currentUser(init);
    return ok(userProfile);
  } catch (error) {
    const accountError = mapAccountError(error, 'Failed to load current user profile');
    const logContext = { error, accountError };
    if (accountError.kind === 'unauthorized' || accountError.kind === 'not_found') {
      logger.warn('Current user profile unavailable', logContext);
    } else if (accountError.kind === 'network') {
      logger.debug('Current user profile unavailable during transient fetch', logContext);
    } else {
      logger.error('Failed to load current user profile', logContext);
    }
    return err(accountError);
  }
};

export const loginUser = async (
  _payload: unknown
): Promise<Result<{ access_token: string }, AccountError>> => {
  return err({ kind: 'unauthorized', message: 'Direct login is disabled.' });
};

export const registerUser = async (_payload: unknown): Promise<Result<true, AccountError>> => {
  return err({ kind: 'server', message: 'Direct registration is disabled.' });
};

export const logoutUser = async (): Promise<Result<true, AccountError>> => {
  try {
    const client = getBrowserClient({ getCsrfToken });
    await client.logout();
    return ok(true);
  } catch (error) {
    logger.error('Failed to logout', { error });
    return err(mapAccountError(error, 'Failed to logout'));
  }
};

export const updateUserSettings = async (settings: {
  full_name?: string;
  theme_preference?: string;
  memory_enabled?: boolean;
  web_search_enabled?: boolean;
  code_execution_enabled?: boolean;
  notifications_enabled?: boolean;
  quick_mode_enabled?: boolean;
  trust_layer_enabled?: boolean;
}): Promise<Result<true, AccountError>> => {
  try {
    const client = getBrowserClient({ getCsrfToken });
    const result = await client.updateSettings(settings);
    if (!result.ok) {
      throw result.error;
    }
    return ok(true);
  } catch (error) {
    logger.error('Failed to update user settings', { error, settings });
    return err(mapAccountError(error, 'Failed to update user settings'));
  }
};
