import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { ApiClientError } from '@taskforceai/api-client/client';

const getStorageSummary = vi.fn();
const getBrowserClient = vi.fn(() => ({ getStorageSummary }));

void vi.mock('@taskforceai/api-client/browserClient', () => ({
  getBrowserClient,
  setBrowserClient: () => {},
  clearBrowserClientCache: () => {},
}));

const { fetchStorageSummary } = await import('./storage');

describe('fetchStorageSummary', () => {
  beforeEach(() => {
    getStorageSummary.mockReset();
    getBrowserClient.mockClear();
  });

  it('returns storage usage from the canonical API client', async () => {
    getStorageSummary.mockResolvedValue({
      usedBytes: 1024,
      quotaBytes: 4096,
      categories: [{ id: 'artifacts', label: 'Artifacts', bytes: 512, count: 3 }],
    });

    const result = await fetchStorageSummary();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.categories[0]?.id).toBe('artifacts');
      expect(result.value.usedBytes).toBe(1024);
    }
    expect(getStorageSummary).toHaveBeenCalledTimes(1);
  });

  it('returns the API error message when the server rejects the request', async () => {
    getStorageSummary.mockRejectedValue(
      new ApiClientError(403, { error: 'Storage access denied' })
    );

    const result = await fetchStorageSummary();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Storage access denied');
    }
  });

  it('falls back to the default error when the error body is not JSON', async () => {
    getStorageSummary.mockRejectedValue(new ApiClientError(500, 'not-json'));

    const result = await fetchStorageSummary();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Failed to load storage usage');
    }
  });

  it('returns a validation error when the success payload has the wrong shape', async () => {
    const validationError = new Error('Invalid storage response');
    validationError.name = 'ZodError';
    getStorageSummary.mockRejectedValue(validationError);

    const result = await fetchStorageSummary();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Invalid response from server');
    }
  });

  it('returns thrown fetch errors without losing the original message', async () => {
    getStorageSummary.mockRejectedValue(new Error('network unavailable'));

    const result = await fetchStorageSummary();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('network unavailable');
    }
  });
});
