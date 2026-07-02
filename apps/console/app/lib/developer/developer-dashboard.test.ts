import { beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../tests/setup/dom';

const loadStoredUserMock = vi.fn();
import { z } from 'zod';

const fetchUsageStatsMock = vi.fn();
const createApiKeyMock = vi.fn();
const revokeApiKeyMock = vi.fn();

vi.mock('../utils/auth-storage', () => ({
  loadStoredUser: loadStoredUserMock,
}));

vi.mock('../api/developer', () => {
  const apiKeyDataSchema = z.object({
    keyId: z.number(),
    displayKey: z.string(),
    tier: z.string(),
    createdAt: z.string(),
    lastUsedAt: z.string().nullable(),
    revokedAt: z.string().nullable(),
    hourlyLimit: z.number(),
    monthlyQuota: z.number(),
    currentHourlyUsage: z.number(),
    dailyUsage: z.number(),
    weeklyUsage: z.number(),
    monthlyUsage: z.number(),
  });

  const usageStatsSchema = z.object({
    totalRequests: z.number(),
    requestsThisMonth: z.number(),
    requestsThisWeek: z.number(),
    requestsToday: z.number(),
    monthlyQuota: z.number(),
    monthlyRemaining: z.number(),
    periodStart: z.string().nullable(),
    periodEnd: z.string().nullable(),
    apiKeys: z.array(apiKeyDataSchema),
    usageHistory: z.array(z.object({ date: z.string(), count: z.number() })),
  });

  return {
    fetchUsageStats: fetchUsageStatsMock,
    createApiKey: createApiKeyMock,
    revokeApiKey: revokeApiKeyMock,
    usageStatsSchema,
  };
});

const readStorageItemMock = vi.fn();
const writeStorageItemMock = vi.fn();
const removeStorageItemMock = vi.fn();

vi.mock('../platform/browser-storage', () => ({
  readStorageItem: readStorageItemMock,
  writeStorageItem: writeStorageItemMock,
  removeStorageItem: removeStorageItemMock,
}));

import { ok, err } from '../utils/result';
import type { UsageStats } from './developer-dashboard';
import {
  clearCachedUsageStats,
  DEVELOPER_STATS_CACHE_KEY,
  readCachedUsageStats,
  writeCachedUsageStats,
  refreshUsageStats,
  createDeveloperApiKey,
  revokeDeveloperApiKey,
} from './developer-dashboard';

const buildUsageStats = (): UsageStats => ({
  totalRequests: 100,
  requestsThisMonth: 10,
  requestsThisWeek: 5,
  requestsToday: 1,
  monthlyQuota: 1000,
  monthlyRemaining: 990,
  periodStart: '2026-02-01T00:00:00.000Z',
  periodEnd: '2026-02-28T23:59:59.000Z',
  apiKeys: [
    {
      keyId: 1,
      displayKey: 'tfai_live_1234',
      tier: 'pro',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastUsedAt: null,
      revokedAt: null,
      hourlyLimit: 500,
      monthlyQuota: 50000,
      currentHourlyUsage: 0,
      dailyUsage: 0,
      weeklyUsage: 0,
      monthlyUsage: 10,
    },
  ],
  usageHistory: [{ date: '2026-02-10T00:00:00.000Z', count: 2 }],
});

describe('developer-dashboard cache scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    loadStoredUserMock.mockReturnValue({
      ok: true,
      value: { id: 7, email: 'owner@taskforceai.chat' },
    });
    readStorageItemMock.mockImplementation((key: string) => {
      const val = window.localStorage.getItem(key);
      if (val === null) {
        return err({ kind: 'missing', message: 'Not found' });
      }
      return ok(val);
    });
    writeStorageItemMock.mockImplementation((key: string, val: string) => {
      try {
        window.localStorage.setItem(key, val);
        return ok(true as const);
      } catch (e: any) {
        return err({ kind: 'storage' as const, message: e.message });
      }
    });
    removeStorageItemMock.mockImplementation((key: string) => {
      try {
        window.localStorage.removeItem(key);
        return ok(true as const);
      } catch (e: any) {
        return err({ kind: 'storage' as const, message: e.message });
      }
    });
  });

  it('writes and reads usage stats under a user-scoped cache key', () => {
    const stats = buildUsageStats();

    const writeResult = writeCachedUsageStats(stats);
    expect(writeResult.ok).toBe(true);

    expect(window.localStorage.getItem(`${DEVELOPER_STATS_CACHE_KEY}:id-7`)).not.toBeNull();
    expect(window.localStorage.getItem(DEVELOPER_STATS_CACHE_KEY)).toBeNull();

    const cached = readCachedUsageStats();
    expect(cached.ok).toBe(true);
    if (cached.ok) {
      expect(cached.value).toEqual(stats);
    }
  });

  it('clears the previous scoped cache when the user changes', () => {
    const stats = buildUsageStats();
    window.localStorage.setItem(`${DEVELOPER_STATS_CACHE_KEY}:id-1`, JSON.stringify(stats));
    window.localStorage.setItem(`${DEVELOPER_STATS_CACHE_KEY}:scope`, 'id-1');

    loadStoredUserMock.mockReturnValue({
      ok: true,
      value: { id: 2, email: 'next@taskforceai.chat' },
    });

    const cached = readCachedUsageStats();
    expect(cached.ok).toBe(false);
    if (!cached.ok) {
      expect(cached.error.kind).toBe('missing');
    }

    expect(window.localStorage.getItem(`${DEVELOPER_STATS_CACHE_KEY}:id-1`)).toBeNull();
    expect(window.localStorage.getItem(`${DEVELOPER_STATS_CACHE_KEY}:scope`)).toBe('id-2');
  });

  it('falls back to anonymous cache scope when no user is stored', () => {
    loadStoredUserMock.mockReturnValue({
      ok: false,
      error: 'NOT_FOUND',
    });

    const stats = buildUsageStats();
    const writeResult = writeCachedUsageStats(stats);

    expect(writeResult.ok).toBe(true);
    expect(window.localStorage.getItem(`${DEVELOPER_STATS_CACHE_KEY}:anonymous`)).not.toBeNull();
  });

  it('falls back to email cache scope when no numeric user ID is stored but email is present', () => {
    loadStoredUserMock.mockReturnValue({
      ok: true,
      value: { email: 'owner@taskforceai.chat' },
    });

    const stats = buildUsageStats();
    const writeResult = writeCachedUsageStats(stats);
    expect(writeResult.ok).toBe(true);
    expect(
      window.localStorage.getItem(`${DEVELOPER_STATS_CACHE_KEY}:email-owner_taskforceai.chat`)
    ).not.toBeNull();
  });

  it('returns invalid JSON error when cache contains invalid JSON', () => {
    window.localStorage.setItem(`${DEVELOPER_STATS_CACHE_KEY}:id-7`, 'not-json');
    const result = readCachedUsageStats();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid');
      expect(result.error.message).toBe('Cached stats invalid JSON');
    }
  });

  it('returns validation error when cached payload is invalid', () => {
    window.localStorage.setItem(
      `${DEVELOPER_STATS_CACHE_KEY}:id-7`,
      JSON.stringify({ invalid: 'field' })
    );
    const result = readCachedUsageStats();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid');
      expect(result.error.message).toBe('Cached stats failed validation');
    }
  });

  it('returns storage error when writeCachedUsageStats fails due to storage error', () => {
    writeStorageItemMock.mockImplementation((key, val) => {
      if (
        key !== `${DEVELOPER_STATS_CACHE_KEY}:scope` &&
        key.startsWith(DEVELOPER_STATS_CACHE_KEY)
      ) {
        return err({ kind: 'storage', message: 'Quota exceeded' });
      }
      window.localStorage.setItem(key, val);
      return ok(true);
    });
    const stats = buildUsageStats();
    const result = writeCachedUsageStats(stats);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('storage');
      expect(result.error.message).toContain('Quota exceeded');
    }
  });

  it('returns storage error when readCachedUsageStats fails due to storage error', () => {
    readStorageItemMock.mockImplementation((key) => {
      if (
        key !== `${DEVELOPER_STATS_CACHE_KEY}:scope` &&
        key.startsWith(DEVELOPER_STATS_CACHE_KEY)
      ) {
        return err({ kind: 'storage', message: 'Storage read error' });
      }
      const val = window.localStorage.getItem(key);
      if (val === null) {
        return err({ kind: 'missing', message: 'Not found' });
      }
      return ok(val);
    });
    const result = readCachedUsageStats();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('storage');
      expect(result.error.message).toContain('Storage read error');
    }
  });

  it('returns storage error when clearCachedUsageStats fails due to storage error', () => {
    removeStorageItemMock.mockReturnValueOnce(
      err({ kind: 'storage', message: 'Storage remove error' })
    );
    const result = clearCachedUsageStats();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('storage');
      expect(result.error.message).toContain('Storage remove error');
    }
  });

  it('refreshUsageStats updates cache on success', async () => {
    const stats = buildUsageStats();
    fetchUsageStatsMock.mockResolvedValue(ok(stats));

    const result = await refreshUsageStats();
    expect(result.ok).toBe(true);
    expect(fetchUsageStatsMock).toHaveBeenCalledTimes(1);

    const cached = readCachedUsageStats();
    expect(cached.ok).toBe(true);
  });

  it('refreshUsageStats returns error on API failure', async () => {
    fetchUsageStatsMock.mockResolvedValue(
      err({ kind: 'server', message: 'Internal Server Error' })
    );

    const result = await refreshUsageStats();
    expect(result.ok).toBe(false);
  });

  it('createDeveloperApiKey delegates to createApiKey', async () => {
    createApiKeyMock.mockResolvedValue(ok({ apiKey: 'tfai_sk_test' }));

    const result = await createDeveloperApiKey();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.apiKey).toBe('tfai_sk_test');
    }
  });

  it('revokeDeveloperApiKey delegates to revokeApiKey', async () => {
    revokeApiKeyMock.mockResolvedValue(ok({ status: 'revoked' }));

    const result = await revokeDeveloperApiKey(42);
    expect(result.ok).toBe(true);
    expect(revokeApiKeyMock).toHaveBeenCalledWith(42);
  });

  it('clears scoped cache keys during explicit cache clear', () => {
    const stats = buildUsageStats();
    window.localStorage.setItem(`${DEVELOPER_STATS_CACHE_KEY}:id-7`, JSON.stringify(stats));
    window.localStorage.setItem(`${DEVELOPER_STATS_CACHE_KEY}:anonymous`, JSON.stringify(stats));
    window.localStorage.setItem(`${DEVELOPER_STATS_CACHE_KEY}:scope`, 'id-7');
    window.localStorage.setItem(DEVELOPER_STATS_CACHE_KEY, JSON.stringify(stats));

    const clearResult = clearCachedUsageStats();
    expect(clearResult.ok).toBe(true);

    expect(window.localStorage.getItem(`${DEVELOPER_STATS_CACHE_KEY}:id-7`)).toBeNull();
    expect(window.localStorage.getItem(`${DEVELOPER_STATS_CACHE_KEY}:anonymous`)).toBeNull();
    expect(window.localStorage.getItem(`${DEVELOPER_STATS_CACHE_KEY}:scope`)).toBeNull();
    expect(window.localStorage.getItem(DEVELOPER_STATS_CACHE_KEY)).toBeNull();
  });
});
