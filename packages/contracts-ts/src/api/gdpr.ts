import { z } from 'zod';

import { getCsrfToken } from '@taskforceai/contracts/auth/csrf';
import { getAuthLogger } from '../auth/logger';
import { type Result, err, ok } from '../utils/result';

const logger = getAuthLogger();

const deleteResponseSchema = z.object({
  message: z.string().optional(),
});

const deleteAccountPayloadSchema = z.object({
  confirmEmail: z.string(),
});

type DeleteAccountPayload = z.infer<typeof deleteAccountPayloadSchema>;

export type ApiError = {
  message: string;
};

export const exportUserData = async (): Promise<Result<Blob, ApiError>> => {
  try {
    const response = await fetch('/api/v1/gdpr/export', {
      method: 'GET',
      credentials: 'include',
    });

    if (!response.ok) {
      return err({ message: 'Failed to export data' });
    }

    const blob = await response.blob();
    return ok(blob);
  } catch (error) {
    logger.error('Failed to export data', { error });
    return err({ message: 'Failed to export data. Please try again.' });
  }
};

export const deleteAccount = async (
  confirmEmail: string
): Promise<Result<{ message: string }, ApiError>> => {
  try {
    const csrfToken = await getCsrfToken();
    const payload: DeleteAccountPayload = deleteAccountPayloadSchema.parse({
      confirmEmail,
    });

    const response = await fetch('/api/v1/gdpr/delete-account', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      credentials: 'include',
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      return err({ message: 'Failed to delete account' });
    }

    let rawData: unknown;
    try {
      rawData = await response.json();
    } catch (error) {
      logger.warn('Failed to parse delete-account success response', { error });
      return ok({ message: 'Account deleted successfully.' });
    }

    const parsed = deleteResponseSchema.safeParse(rawData);
    if (!parsed.success) {
      logger.warn('Invalid response format from delete-account endpoint', {
        issues: parsed.error.issues,
      });
      return ok({ message: 'Account deleted successfully.' });
    }

    return ok({ message: parsed.data.message || 'Account deleted successfully.' });
  } catch (error) {
    logger.error('Failed to delete account', { error });
    return err({ message: 'Failed to delete account. Please contact support.' });
  }
};
