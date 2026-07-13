import { afterEach, describe, expect, it, vi } from 'bun:test';

import { submitLocalDevLogin } from './test-login';

const originalFetch = globalThis.fetch;

describe('submitLocalDevLogin', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('submits a local development login request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await submitLocalDevLogin('local-dev@taskforceai.test');

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/test-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email: 'local-dev@taskforceai.test' }),
    });
  });

  it('reports API detail messages and falls back to status text', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: vi.fn().mockResolvedValue({ detail: 'Test login disabled' }),
    }) as unknown as typeof fetch;

    await expect(submitLocalDevLogin('blocked@taskforceai.test')).rejects.toThrow(
      'Test login disabled'
    );

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: vi.fn().mockRejectedValue(new Error('invalid json')),
    }) as unknown as typeof fetch;

    await expect(submitLocalDevLogin('error@taskforceai.test')).rejects.toThrow(
      'Local sign-in failed (500)'
    );
  });
});
