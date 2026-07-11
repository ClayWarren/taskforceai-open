import { afterEach, describe, expect, it, vi } from 'bun:test';

import { fetchStorageSummary } from './storage';

type FetchMock = ReturnType<typeof vi.fn> & typeof fetch;

const originalFetch = globalThis.fetch;

const installFetch = (
  impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
): FetchMock => {
  const fetchMock = Object.assign(vi.fn(impl), { preconnect: vi.fn() }) as unknown as FetchMock;
  globalThis.fetch = fetchMock;
  return fetchMock;
};

const createStorageResponse = (body: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

describe('fetchStorageSummary', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns parsed storage usage and sends included credentials', async () => {
    const fetchMock = installFetch(async () =>
      createStorageResponse({
        usedBytes: 1024,
        quotaBytes: 4096,
        categories: [{ id: 'artifacts', label: 'Artifacts', bytes: 512, count: 3 }],
      })
    );

    const result = await fetchStorageSummary();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.categories[0]?.id).toBe('artifacts');
      expect(result.value.usedBytes).toBe(1024);
    }
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/developer/storage', {
      credentials: 'include',
    });
  });

  it('returns the API error message when the server rejects the request', async () => {
    installFetch(async () =>
      createStorageResponse({ error: 'Storage access denied' }, { status: 403 })
    );

    const result = await fetchStorageSummary();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Storage access denied');
    }
  });

  it('falls back to the default error when the error body is not JSON', async () => {
    installFetch(
      async () =>
        new Response('not-json', {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
    );

    const result = await fetchStorageSummary();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Failed to load storage usage');
    }
  });

  it('returns a validation error when the success payload has the wrong shape', async () => {
    installFetch(async () =>
      createStorageResponse({
        usedBytes: '1024',
        quotaBytes: 4096,
        categories: [],
      })
    );

    const result = await fetchStorageSummary();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Invalid response from server');
    }
  });

  it('returns thrown fetch errors without losing the original message', async () => {
    installFetch(async () => {
      throw new Error('network unavailable');
    });

    const result = await fetchStorageSummary();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('network unavailable');
    }
  });
});
