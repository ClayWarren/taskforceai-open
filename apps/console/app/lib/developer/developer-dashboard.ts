import {
  ANONYMOUS_CACHE_SCOPE,
  resolveUserCacheScope,
} from '@taskforceai/persistence/storage/cache-scope';

import {
  type ApiError,
  type UsageStats,
  createApiKey,
  fetchUsageStats,
  revokeApiKey,
  usageStatsSchema,
} from '../api/developer';
import { loadStoredUser } from '@taskforceai/api-client/auth/auth-storage';
import {
  readStorageItem,
  removeStorageItem,
  writeStorageItem,
} from '@taskforceai/browser-runtime/browser-storage';
import { type Result, err, ok } from '@taskforceai/client-core/result';

export const DEVELOPER_STATS_CACHE_KEY = 'developer-stats-cache';
const DEVELOPER_STATS_SCOPE_KEY = `${DEVELOPER_STATS_CACHE_KEY}:scope`;

const getScopedCacheKey = (scope: string): string => `${DEVELOPER_STATS_CACHE_KEY}:${scope}`;

const getActiveScopedCacheKey = (): string => {
  const scope = resolveUserCacheScope(loadStoredUser());
  const previousScope = readStorageItem(DEVELOPER_STATS_SCOPE_KEY);

  if (previousScope.ok && previousScope.value !== scope) {
    removeStorageItem(getScopedCacheKey(previousScope.value));
  }

  if (!previousScope.ok || previousScope.value !== scope) {
    writeStorageItem(DEVELOPER_STATS_SCOPE_KEY, scope);
  }

  // Remove legacy unscoped cache key so stats cannot bleed across users.
  removeStorageItem(DEVELOPER_STATS_CACHE_KEY);

  return getScopedCacheKey(scope);
};

export type UsageStatsCacheError = {
  kind: 'missing' | 'invalid' | 'storage';
  message: string;
};

export type { UsageStats };

/**
 * Read cached developer usage stats from localStorage.
 */
export const readCachedUsageStats = (): Result<UsageStats, UsageStatsCacheError> => {
  const cached = readStorageItem(getActiveScopedCacheKey());
  if (!cached.ok) {
    if (cached.error.kind === 'missing') {
      return err({ kind: 'missing', message: 'No cached stats found' });
    }
    return err({ kind: 'storage', message: cached.error.message });
  }

  let parsedJson;
  try {
    parsedJson = JSON.parse(cached.value);
  } catch {
    return err({ kind: 'invalid', message: 'Cached stats invalid JSON' });
  }

  const parsed = usageStatsSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return err({ kind: 'invalid', message: 'Cached stats failed validation' });
  }

  return ok(parsed.data);
};

/**
 * Persist developer usage stats to localStorage.
 */
export const writeCachedUsageStats = (stats: UsageStats): Result<true, UsageStatsCacheError> => {
  const result = writeStorageItem(getActiveScopedCacheKey(), JSON.stringify(stats));
  if (!result.ok) {
    return err({ kind: 'storage', message: result.error.message });
  }
  return ok(true);
};

/**
 * Clear all known developer usage stats cache entries.
 */
export const clearCachedUsageStats = (): Result<true, UsageStatsCacheError> => {
  const keysToRemove = new Set<string>([
    DEVELOPER_STATS_CACHE_KEY,
    DEVELOPER_STATS_SCOPE_KEY,
    getScopedCacheKey(ANONYMOUS_CACHE_SCOPE),
    getScopedCacheKey(resolveUserCacheScope(loadStoredUser())),
  ]);

  const previousScope = readStorageItem(DEVELOPER_STATS_SCOPE_KEY);
  if (previousScope.ok) {
    keysToRemove.add(getScopedCacheKey(previousScope.value));
  }

  for (const key of keysToRemove) {
    const removeResult = removeStorageItem(key);
    if (!removeResult.ok && removeResult.error.kind !== 'missing') {
      return err({ kind: 'storage', message: removeResult.error.message });
    }
  }

  return ok(true);
};

/**
 * Fetch latest usage stats and update cache on success.
 */
export const refreshUsageStats = async (): Promise<Result<UsageStats, ApiError>> => {
  const result = await fetchUsageStats();
  if (result.ok) {
    writeCachedUsageStats(result.value);
  }
  return result;
};

/**
 * Create an API key for the current user.
 */
export const createDeveloperApiKey = async (): Promise<Result<{ apiKey: string }, ApiError>> => {
  return createApiKey();
};

/**
 * Revoke a developer API key.
 */
export const revokeDeveloperApiKey = async (
  keyId: number
): Promise<Result<{ status: 'revoked' }, ApiError>> => {
  return revokeApiKey(keyId);
};
