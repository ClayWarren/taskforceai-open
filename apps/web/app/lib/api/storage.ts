import { z } from 'zod';

import { type Result, err, ok } from '@taskforceai/client-core/result';
import { readApiErrorMessage } from '@taskforceai/api-client/api/response';
import { logger } from '../logger';

const storageCategorySchema = z.object({
  id: z.string(),
  label: z.string(),
  bytes: z.number(),
  count: z.number(),
});

const storageSummarySchema = z.object({
  usedBytes: z.number(),
  quotaBytes: z.number(),
  categories: z.array(storageCategorySchema),
});

export type StorageCategory = z.infer<typeof storageCategorySchema>;
export type StorageSummary = z.infer<typeof storageSummarySchema>;

async function readJsonResponse(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

export async function fetchStorageSummary(): Promise<Result<StorageSummary>> {
  try {
    const response = await fetch('/api/v1/developer/storage', {
      credentials: 'include',
    });
    const rawBody = await readJsonResponse(response);
    if (!response.ok) {
      return err(new Error(readApiErrorMessage(rawBody) ?? 'Failed to load storage usage'));
    }
    const parsed = storageSummarySchema.safeParse(rawBody);
    if (!parsed.success) {
      logger.warn('Storage API response validation failed', { error: parsed.error.flatten() });
      return err(new Error('Invalid response from server'));
    }
    return ok(parsed.data);
  } catch (error) {
    logger.error('Failed to fetch storage summary', { error });
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
