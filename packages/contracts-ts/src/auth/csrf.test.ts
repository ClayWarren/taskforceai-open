import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import { getCsrfToken, withCsrf } from './csrf';

const createFetchMock = (
  impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
): typeof fetch => Object.assign(vi.fn(impl), { preconnect: vi.fn() });
const jsonResponse = (body: unknown = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const originalFetch = globalThis.fetch;
const originalDocument = globalThis.document;

describe('shared/auth/csrf', () => {
  let cookieValue = '';

  const setCookie = (value: string) => {
    cookieValue = value;
  };

  beforeEach(() => {
    cookieValue = '';
    Object.defineProperty(globalThis, 'document', {
      value: {
        get cookie() {
          return cookieValue;
        },
        set cookie(value: string) {
          cookieValue = value;
        },
      },
      configurable: true,
      writable: true,
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (typeof originalDocument === 'undefined') {
      // @ts-expect-error - deleting test-injected document
      delete globalThis.document;
    } else {
      globalThis.document = originalDocument;
    }
    vi.restoreAllMocks();
  });

  it('returns cookie token without fetching when cookie is present', async () => {
    setCookie('other=1; csrf_token=cookie-token');
    const fetchMock = createFetchMock(async () => jsonResponse({ csrfToken: 'network-token' }));
    globalThis.fetch = fetchMock;

    const token = await getCsrfToken();

    expect(token).toBe('cookie-token');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns empty string when csrf cookie encoding is invalid', async () => {
    setCookie('csrf_token=%E0%A4%A');

    const token = await getCsrfToken();

    expect(token).toBe('');
  });

  it('does not use a network token when no csrf cookie was established', async () => {
    setCookie('');
    const fetchMock = createFetchMock(async () => jsonResponse({ csrfToken: 'fetched-token' }));
    globalThis.fetch = fetchMock;

    const first = await getCsrfToken(true);
    const second = await getCsrfToken();

    expect(first).toBe('');
    expect(second).toBe('');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses the refreshed csrf cookie set by the network response', async () => {
    setCookie('');
    const fetchMock = createFetchMock(async () => {
      setCookie('csrf_token=fetched-cookie-token');
      return jsonResponse({ csrfToken: 'network-token' });
    });
    globalThis.fetch = fetchMock;

    const token = await getCsrfToken(true);

    expect(token).toBe('fetched-cookie-token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('prefers cookie token over previously cached token', async () => {
    setCookie('');
    const fetchMock = createFetchMock(async () => jsonResponse({ csrfToken: 'cached-token' }));
    globalThis.fetch = fetchMock;

    await getCsrfToken(true);
    setCookie('csrf_token=cookie-override');

    const token = await getCsrfToken();

    expect(token).toBe('cookie-override');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('force refresh prefers refreshed cookie token over response token', async () => {
    setCookie('csrf_token=stale-cookie');
    const fetchMock = createFetchMock(async () => {
      setCookie('csrf_token=fresh-cookie');
      return jsonResponse({ csrfToken: 'response-token' });
    });
    globalThis.fetch = fetchMock;

    const token = await getCsrfToken(true);

    expect(token).toBe('fresh-cookie');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns empty token when refresh fetch fails', async () => {
    setCookie('');
    const fetchMock = createFetchMock(async () => {
      throw new Error('Offline');
    });
    globalThis.fetch = fetchMock;

    const token = await getCsrfToken(true);

    expect(token).toBe('');
  });

  it('ignores malformed csrf cookie encoding but still requires a refreshed cookie', async () => {
    setCookie('csrf_token=%E0%A4%A');
    const fetchMock = createFetchMock(async () => jsonResponse({ csrfToken: 'network-token' }));
    globalThis.fetch = fetchMock;

    const token = await getCsrfToken(true);

    expect(token).toBe('');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('adds CSRF header for state-changing methods', async () => {
    setCookie('csrf_token=cookie-token');

    const init = await withCsrf({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const headers = new Headers(init.headers);
    expect(headers.get('X-CSRF-Token')).toBe('cookie-token');
  });

  it('returns init unchanged for GET requests', async () => {
    const init: RequestInit = {
      method: 'GET',
      headers: { Accept: 'application/json' },
    };

    const result = await withCsrf(init);

    expect(result).toBe(init);
  });

  it('leaves headers unchanged when no csrf token can be resolved', async () => {
    setCookie('');
    const resetFetch = createFetchMock(async () => jsonResponse());
    globalThis.fetch = resetFetch;
    await getCsrfToken(true);

    const failingFetch = createFetchMock(async () => {
      throw new Error('Network unavailable');
    });
    globalThis.fetch = failingFetch;

    const init = await withCsrf({
      method: 'DELETE',
      headers: { Accept: 'application/json' },
    });

    const headers = new Headers(init.headers);
    expect(headers.get('X-CSRF-Token')).toBeNull();
  });
});
