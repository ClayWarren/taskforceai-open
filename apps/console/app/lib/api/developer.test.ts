import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import { fetchUsageStats, createApiKey, revokeApiKey } from './developer';
import { getCsrfToken } from '../auth/csrf';

vi.mock('../auth/csrf', () => ({
  getCsrfToken: vi.fn(),
}));

vi.mock('../logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('developer api', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn() as any;
    (getCsrfToken as any).mockResolvedValue('test-csrf-token');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('fetchUsageStats', () => {
    it('returns usage stats on success', async () => {
      const mockStats = {
        totalRequests: 100,
        requestsThisMonth: 50,
        requestsThisWeek: 25,
        requestsToday: 5,
        monthlyQuota: 1000,
        monthlyRemaining: 950,
        periodStart: '2026-02-01',
        periodEnd: '2026-03-01',
        apiKeys: [],
        usageHistory: [],
      };
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockStats),
      });

      const result = await fetchUsageStats();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.totalRequests).toBe(100);
        expect(result.value.monthlyQuota).toBe(1000);
      }
    });

    it('returns server error on non-ok response', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Internal server error' }),
      });

      const result = await fetchUsageStats();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('server');
        expect(result.error.status).toBe(500);
      }
    });

    it('reads huma detail fields from server errors', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ status: 400, detail: 'Key limit reached (10)' }),
      });

      const result = await fetchUsageStats();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('server');
        expect(result.error.message).toBe('Key limit reached (10)');
      }
    });

    it('returns validation error on invalid payload', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ invalid: 'data' }),
      });

      const result = await fetchUsageStats();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('validation');
      }
    });

    it('returns network error on fetch failure', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      const result = await fetchUsageStats();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('network');
      }
    });

    it('returns server error with unknown message when json parsing fails in readErrorMessage', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('JSON parse error')),
      });

      const result = await fetchUsageStats();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('server');
        expect(result.error.message).toBe('Unknown error');
      }
    });

    it('returns server error with unknown message when error response fields are empty', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      });

      const result = await fetchUsageStats();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('server');
        expect(result.error.message).toBe('Unknown error');
      }
    });
  });

  describe('createApiKey', () => {
    it('returns api key on success', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ apiKey: 'sk_test_123456789' }),
      });

      const result = await createApiKey();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.apiKey).toBe('sk_test_123456789');
      }
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/developer/keys',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'X-CSRF-Token': 'test-csrf-token',
          }),
        })
      );
    });

    it('returns server error on non-ok response', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'Key limit reached' }),
      });

      const result = await createApiKey();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('server');
        expect(result.error.status).toBe(400);
      }
    });

    it('returns validation error when create API key response fails schema validation', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ invalidKey: 'no-apiKey-here' }),
      });

      const result = await createApiKey();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('validation');
        expect(result.error.message).toBe('Create API key response invalid');
      }
    });

    it('returns network error on fetch failure', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      const result = await createApiKey();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('network');
      }
    });
  });

  describe('revokeApiKey', () => {
    it('returns revoked status on success', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const result = await revokeApiKey(1);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('revoked');
      }
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/developer/keys',
        expect.objectContaining({
          method: 'DELETE',
          body: JSON.stringify({ keyId: 1 }),
        })
      );
    });

    it('returns server error on non-ok response', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: 'Key not found' }),
      });

      const result = await revokeApiKey(999);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('server');
        expect(result.error.status).toBe(404);
      }
    });

    it('returns network error on fetch failure', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      const result = await revokeApiKey(1);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('network');
      }
    });
  });
});
