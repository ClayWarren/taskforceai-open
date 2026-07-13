import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import type { StatusResponse } from '@taskforceai/contracts/api/status';

const statusMetricsStopTimer = vi.fn();
const statusMetricsMock = {
  incrementCounter: vi.fn(),
  startTimer: vi.fn(() => statusMetricsStopTimer),
};

vi.mock('../observability/metrics', () => ({
  statusMetrics: statusMetricsMock,
}));

const { fetchStatus, isStatusSnapshotFresh, resolveStatusJsonUrl, timedSignal } =
  await import('./status');

const VALID_STATUS: StatusResponse = {
  overallStatus: 'operational',
  services: [
    {
      id: 'api',
      name: 'API',
      status: 'operational',
      uptimePercent: 99.9,
      uptimeHistory: [{ date: '2026-01-01', status: 'operational' }],
    },
  ],
  incidents: [],
  lastUpdated: new Date().toISOString(),
};

describe('fetchStatus', () => {
  const originalFetch = global.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
    statusMetricsMock.incrementCounter.mockClear();
    statusMetricsMock.startTimer.mockClear();
    statusMetricsStopTimer.mockClear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // --- happy path ---

  it('returns validated status from primary source', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => VALID_STATUS,
    });

    const status = await fetchStatus();
    expect(status).toEqual(VALID_STATUS);
    expect(mockFetch).toHaveBeenCalledWith('/status.json', expect.any(Object));
    expect(statusMetricsMock.incrementCounter).toHaveBeenCalledWith('status.fetch.success', {
      source: 'static',
    });
    expect(statusMetricsStopTimer).toHaveBeenCalledTimes(1);
  });

  it('accepts JSON content-type with mixed casing', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'Application/JSON; charset=utf-8' }),
      json: async () => VALID_STATUS,
    });

    const status = await fetchStatus();
    expect(status).toEqual(VALID_STATUS);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('accepts structured JSON media types', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/problem+json; charset=utf-8' }),
      json: async () => VALID_STATUS,
    });

    const status = await fetchStatus();
    expect(status).toEqual(VALID_STATUS);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to /api/v1/status if primary source is unavailable', async () => {
    const fallbackStatus: StatusResponse = { ...VALID_STATUS, overallStatus: 'degraded' };

    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 }).mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => fallbackStatus,
    });

    const status = await fetchStatus();
    expect(status).toEqual(fallbackStatus);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenNthCalledWith(2, '/api/v1/status', expect.any(Object));
    expect(statusMetricsMock.incrementCounter).toHaveBeenCalledWith('status.fetch.failure', {
      source: 'static',
      error: 'Error',
    });
    expect(statusMetricsMock.incrementCounter).toHaveBeenCalledWith('status.fetch.success', {
      source: 'api',
    });
  });

  it('rejects a stale static snapshot and returns the fresh live status', async () => {
    const staleStatus: StatusResponse = {
      ...VALID_STATUS,
      lastUpdated: '2026-01-28T12:00:00Z',
    };
    const liveStatus: StatusResponse = {
      ...VALID_STATUS,
      overallStatus: 'degraded',
      lastUpdated: new Date().toISOString(),
    };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => staleStatus,
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => liveStatus,
      });

    const status = await fetchStatus();

    expect(status).toEqual(liveStatus);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenNthCalledWith(2, '/api/v1/status', expect.any(Object));
    expect(statusMetricsMock.incrementCounter).toHaveBeenCalledWith('status.fetch.failure', {
      source: 'static',
      error: 'StaleStatusSnapshotError',
    });
  });

  it('returns null instead of presenting stale status when both sources are stale', async () => {
    const staleStatus: StatusResponse = {
      ...VALID_STATUS,
      lastUpdated: '2026-01-28T12:00:00Z',
    };

    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => staleStatus,
    });

    const status = await fetchStatus();

    expect(status).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('times out a stalled primary response body and falls back to the API', async () => {
    vi.useFakeTimers();
    const fallbackStatus: StatusResponse = { ...VALID_STATUS, overallStatus: 'maintenance' };

    mockFetch
      .mockImplementationOnce((...args: Parameters<typeof fetch>) => {
        const signal = args[1]?.signal;
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () =>
            new Promise<never>((_, reject) => {
              signal?.addEventListener(
                'abort',
                () => reject(new DOMException('Aborted', 'AbortError')),
                { once: true }
              );
            }),
        });
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => fallbackStatus,
      });

    const statusPromise = fetchStatus();
    await Promise.resolve();
    vi.advanceTimersByTime(10000);

    const status = await statusPromise;
    expect(status).toEqual(fallbackStatus);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenNthCalledWith(2, '/api/v1/status', expect.any(Object));
  });

  // --- both sources fail → null ---

  it('returns null when both sources fail with network errors', async () => {
    mockFetch.mockRejectedValue(new Error('Network failure'));

    const status = await fetchStatus();
    expect(status).toBeNull();
    expect(statusMetricsMock.incrementCounter).toHaveBeenCalledWith('status.fetch.unavailable');
  });

  it('returns null when primary is non-JSON and fallback returns non-OK', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'text/html' }),
      })
      .mockResolvedValueOnce({ ok: false, status: 503 });

    const status = await fetchStatus();
    expect(status).toBeNull();
  });

  it('falls back when the primary response omits content-type', async () => {
    const fallbackStatus: StatusResponse = { ...VALID_STATUS, overallStatus: 'degraded' };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => fallbackStatus,
      });

    const status = await fetchStatus();
    expect(status).toEqual(fallbackStatus);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenNthCalledWith(2, '/api/v1/status', expect.any(Object));
  });

  it('returns null when primary returns non-OK and fallback throws', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockRejectedValueOnce(new Error('API also down'));

    const status = await fetchStatus();
    expect(status).toBeNull();
  });

  // --- Zod schema validation ---

  it('falls through to fallback when primary response fails schema validation', async () => {
    const malformed = { overallStatus: 'unknown_status', services: 'not-an-array' };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => malformed,
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => VALID_STATUS,
      });

    const status = await fetchStatus();
    expect(status).toEqual(VALID_STATUS);
  });

  it('returns null when both sources return malformed data', async () => {
    const malformed = { overallStatus: 'unknown_status', services: 'not-an-array' };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => malformed,
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => malformed,
      });

    const status = await fetchStatus();
    expect(status).toBeNull();
  });

  // --- external AbortSignal ---

  it('returns null immediately when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    // fetch should still be called but the result is discarded
    mockFetch.mockRejectedValue(new DOMException('Aborted', 'AbortError'));

    const status = await fetchStatus(controller.signal);
    expect(status).toBeNull();
    expect(statusMetricsMock.incrementCounter).toHaveBeenCalledWith('status.fetch.skipped', {
      reason: 'aborted',
    });
  });
});

describe('isStatusSnapshotFresh', () => {
  const now = Date.parse('2026-07-11T04:00:00Z');

  it('accepts recent timestamps within clock skew', () => {
    expect(isStatusSnapshotFresh('2026-07-11T03:55:00Z', now)).toBe(true);
    expect(isStatusSnapshotFresh('2026-07-11T04:01:00Z', now)).toBe(true);
  });

  it('rejects stale, invalid, and implausibly future timestamps', () => {
    expect(isStatusSnapshotFresh('2026-07-11T03:54:59Z', now)).toBe(false);
    expect(isStatusSnapshotFresh('not-a-date', now)).toBe(false);
    expect(isStatusSnapshotFresh('2026-07-11T04:01:01Z', now)).toBe(false);
  });
});

describe('resolveStatusJsonUrl', () => {
  it('returns the default URL when env is missing', () => {
    expect(resolveStatusJsonUrl(undefined)).toBe('/status.json');
  });

  it('accepts absolute http/https URLs regardless of length', () => {
    expect(resolveStatusJsonUrl('http://x.y')).toBe('http://x.y');
    expect(resolveStatusJsonUrl('https://status.taskforce.ai/status.json')).toBe(
      'https://status.taskforce.ai/status.json'
    );
  });

  it('accepts root-relative paths', () => {
    expect(resolveStatusJsonUrl('/custom-status.json')).toBe('/custom-status.json');
  });

  it('falls back to default for invalid or unsupported URLs', () => {
    expect(resolveStatusJsonUrl('//evil.example/status.json')).toBe('/status.json');
    expect(resolveStatusJsonUrl('ftp://status.taskforce.ai/status.json')).toBe('/status.json');
    expect(resolveStatusJsonUrl('not-a-url')).toBe('/status.json');
  });
});

describe('timedSignal', () => {
  it('returns a signal that aborts after specified timeout', async () => {
    const { signal, cleanup } = timedSignal(50);

    expect(signal.aborted).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(signal.aborted).toBe(true);
    cleanup();
  });

  it('returns a cleanup function that clears the timeout', () => {
    const { signal, cleanup } = timedSignal(5000);

    cleanup();

    expect(signal.aborted).toBe(false);
  });

  it('aborts when external signal is aborted', () => {
    const externalController = new AbortController();
    const { signal, cleanup } = timedSignal(5000, externalController.signal);

    externalController.abort();

    expect(signal.aborted).toBe(true);
    cleanup();
  });

  it('cleanup removes external abort listener', () => {
    const externalController = new AbortController();
    const { cleanup } = timedSignal(5000, externalController.signal);

    cleanup();

    // Should not throw when aborting after cleanup
    externalController.abort();
  });
});
