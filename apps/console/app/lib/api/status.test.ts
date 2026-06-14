import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import { fetchStatus } from './status';
import { SERVICE_IDS } from '../../components/status/types';

vi.mock('./server-base-url', () => ({
  getServerBaseUrl: () => 'http://localhost:3000',
}));

describe('status api', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn() as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('fetchStatus', () => {
    it('returns status from API on success', async () => {
      const mockStatus = {
        overallStatus: 'operational',
        services: [
          {
            id: SERVICE_IDS.API,
            name: 'API',
            status: 'operational',
            uptimePercent: 99.9,
            uptimeHistory: [],
          },
        ],
        lastUpdated: '2026-02-21T12:00:00Z',
      };
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockStatus),
      });

      const result = await fetchStatus();
      expect(result.overallStatus).toBe('operational');
      expect(result.services).toHaveLength(1);
      expect(result.services[0]!.id).toBe(SERVICE_IDS.API);
    });

    it('returns mock status when useMock is true', async () => {
      const result = await fetchStatus({ useMock: true });
      expect(result.overallStatus).toBe('operational');
      expect(result.services.length).toBeGreaterThan(0);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('returns mock status on API failure', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
      });

      const result = await fetchStatus();
      expect(result.overallStatus).toBe('outage');
      expect(result.services.length).toBeGreaterThan(0);
    });

    it('returns mock status on network error', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      const result = await fetchStatus();
      expect(result.overallStatus).toBe('outage');
      expect(result.services.length).toBeGreaterThan(0);
    });

    it('generates uptime history with correct date format', async () => {
      const result = await fetchStatus({ useMock: true });
      const firstService = result.services[0];
      expect(firstService!.uptimeHistory.length).toBeGreaterThan(0);

      const firstDay = firstService!.uptimeHistory[0];
      expect(firstDay!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('calculates uptime percent correctly', async () => {
      const result = await fetchStatus({ useMock: true });
      result.services.forEach((service) => {
        expect(service.uptimePercent).toBeGreaterThanOrEqual(0);
        expect(service.uptimePercent).toBeLessThanOrEqual(100);
      });
    });

    it('falls back to outage payload when API response fails validation', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ overallStatus: 'broken', services: [] }),
      });

      const result = await fetchStatus();

      expect(result.overallStatus).toBe('outage');
      expect(result.services.length).toBeGreaterThan(0);
      expect(result.services.every((service) => service.status === 'outage')).toBe(true);
    });
  });
});
