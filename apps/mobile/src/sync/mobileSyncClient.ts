import { createHttpSyncClient, type SyncClient } from '@taskforceai/sync-client';

import { getMobilePinnedFetch } from '../api/client';
import { mobileEnv } from '../config/env';

export interface SyncClientOptions {
  baseUrl: string;
  getToken: () => Promise<string | null>;
}

/**
 * Shared HTTP sync client used by the sync engine and realtime listeners.
 * Uses HTTP polling instead of SSE for Vercel serverless compatibility.
 */
export function createMobileSyncClient({ baseUrl, getToken }: SyncClientOptions): SyncClient {
  return createHttpSyncClient(baseUrl, getToken, {
    fetchImpl: getMobilePinnedFetch(),
    isProduction: mobileEnv.nodeEnv === 'production',
  });
}
