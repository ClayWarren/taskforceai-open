import { z } from 'zod';
import { getCsrfToken } from '../auth/csrf';
import { getAuthLogger } from '../auth/logger';

const logger = getAuthLogger();

const errorSchema = z
  .object({
    error: z.string().optional(),
  })
  .passthrough();

const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const payload: unknown = await response.json();
    const parsed = errorSchema.safeParse(payload);
    if (parsed.success && parsed.data.error) {
      return parsed.data.error;
    }
  } catch (error) {
    logger.warn('Failed to parse device authorize error response', {
      error,
      status: response.status,
    });
  }
  return 'Unexpected error';
};

export type DeviceAuthorizeResult =
  | { status: 'success' }
  | { status: 'unauthorized' }
  | { status: 'expired' }
  | { status: 'not_found' }
  | { status: 'error'; message: string };

export const authorizeDeviceCode = async (userCode: string): Promise<DeviceAuthorizeResult> => {
  try {
    const csrfToken = await getCsrfToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      // Signals an intentional XHR request; backend treats this as non-CSRF-vulnerable.
      'X-Requested-With': 'XMLHttpRequest',
    };
    if (csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }

    const response = await fetch('/api/v1/auth/device/authorize', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ user_code: userCode }),
    });

    if (response.status === 401) return { status: 'unauthorized' };
    if (response.status === 200) return { status: 'success' };
    if (response.status === 410) return { status: 'expired' };
    if (response.status === 404) return { status: 'not_found' };

    const detail = await readErrorMessage(response);
    return { status: 'error', message: detail };
  } catch (error) {
    logger.error('Device login authorize request failed', { error });
    return { status: 'error', message: 'Something went wrong. Please try again.' };
  }
};
