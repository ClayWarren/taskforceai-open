import { ApiClientError } from '@taskforceai/api-client/client';
import { getBrowserClient } from '@taskforceai/api-client/browserClient';
import { type Result, err, ok } from '@taskforceai/client-core/result';
import { readApiErrorMessage } from '@taskforceai/api-client/api/response';
import type { StorageSummary } from '@taskforceai/contracts/contracts';
import { logger } from '../logger';

export type { StorageSummary };

export async function fetchStorageSummary(): Promise<Result<StorageSummary>> {
  try {
    return ok(await getBrowserClient().getStorageSummary());
  } catch (error) {
    logger.error('Failed to fetch storage summary', { error });
    if (error instanceof ApiClientError) {
      return err(new Error(readApiErrorMessage(error.body) ?? 'Failed to load storage usage'));
    }
    if (error instanceof Error && error.name === 'ZodError') {
      logger.warn('Storage API response validation failed', { error });
      return err(new Error('Invalid response from server'));
    }
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
