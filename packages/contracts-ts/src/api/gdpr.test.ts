import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';

mock.module('@taskforceai/contracts/auth/csrf', () => ({
  getCsrfToken: vi.fn(async () => 'csrf-token'),
  withCsrf: vi.fn(async (init: RequestInit = {}) => init),
}));

mock.module('../auth/logger', () => ({
  getAuthLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { deleteAccount, exportUserData } from './gdpr';

const createFetchMock = (
  impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
): typeof fetch => Object.assign(vi.fn(impl), { preconnect: vi.fn() });

describe('gdpr api helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports user data as a blob', async () => {
    const fetchMock = createFetchMock(async () => new Response('export-data', { status: 200 }));
    globalThis.fetch = fetchMock;

    const result = await exportUserData();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(await result.value.text()).toBe('export-data');
    }
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/gdpr/export', {
      method: 'GET',
      credentials: 'include',
    });
  });

  it('returns an error when export fails', async () => {
    globalThis.fetch = createFetchMock(async () => new Response(null, { status: 500 }));

    const result = await exportUserData();

    expect(result).toEqual({ ok: false, error: { message: 'Failed to export data' } });
  });

  it('deletes an account with csrf protection', async () => {
    const fetchMock = createFetchMock(
      async () =>
        new Response(JSON.stringify({ message: 'Deleted' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );
    globalThis.fetch = fetchMock;

    const result = await deleteAccount('test@example.com');

    expect(result).toEqual({ ok: true, value: { message: 'Deleted' } });
    const call = (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    if (!call) throw new Error('Expected delete-account request');
    const [, init] = call;
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get('X-CSRF-Token')).toBe('csrf-token');
    expect((init as RequestInit).body).toBe(JSON.stringify({ confirmEmail: 'test@example.com' }));
  });

  it('uses a default delete message when response shape is invalid', async () => {
    globalThis.fetch = createFetchMock(
      async () =>
        new Response(JSON.stringify({ message: 42 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );

    const result = await deleteAccount('test@example.com');

    expect(result).toEqual({
      ok: true,
      value: { message: 'Account deleted successfully.' },
    });
  });

  it('returns an error when delete fails', async () => {
    globalThis.fetch = createFetchMock(async () => new Response(null, { status: 500 }));

    const result = await deleteAccount('test@example.com');

    expect(result).toEqual({ ok: false, error: { message: 'Failed to delete account' } });
  });
});
