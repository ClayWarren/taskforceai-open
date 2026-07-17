import { describe, expect, it, vi } from 'bun:test';

import { createDesktopApiFetch } from './api-fetch';

describe('desktop API fetch bridge', () => {
  it('routes supported relative API requests through the app-server', async () => {
    const baseFetch = vi.fn();
    const requestApi = vi.fn().mockResolvedValue({ status: 200, body: [{ id: 'agent-1' }] });
    const desktopFetch = createDesktopApiFetch(baseFetch as unknown as typeof fetch, requestApi);

    const response = await desktopFetch('/api/v1/agents');

    expect(requestApi).toHaveBeenCalledWith({ method: 'GET', path: '/api/v1/agents' });
    expect(baseFetch).not.toHaveBeenCalled();
    expect(await response.json()).toEqual([{ id: 'agent-1' }]);
  });

  it('routes supported production API URLs and preserves JSON mutations', async () => {
    const baseFetch = vi.fn();
    const requestApi = vi.fn().mockResolvedValue({ status: 204 });
    const desktopFetch = createDesktopApiFetch(baseFetch as unknown as typeof fetch, requestApi);

    const response = await desktopFetch('https://taskforceai.chat/api/v1/finances/sync', {
      method: 'POST',
      body: JSON.stringify({ refresh: true }),
    });

    expect(requestApi).toHaveBeenCalledWith({
      method: 'POST',
      path: '/api/v1/finances/sync',
      body: { refresh: true },
    });
    expect(response.status).toBe(204);
  });

  it('acknowledges browser CSRF refreshes without exposing desktop credentials', async () => {
    const baseFetch = vi.fn();
    const requestApi = vi.fn();
    const desktopFetch = createDesktopApiFetch(baseFetch as unknown as typeof fetch, requestApi);

    const response = await desktopFetch('/api/auth/csrf');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
    expect(requestApi).not.toHaveBeenCalled();
    expect(baseFetch).not.toHaveBeenCalled();
  });

  it('leaves unsupported and third-party requests on the original fetch', async () => {
    const original = new Response('original', { status: 200 });
    const baseFetch = vi.fn().mockResolvedValue(original);
    const requestApi = vi.fn();
    const desktopFetch = createDesktopApiFetch(baseFetch as unknown as typeof fetch, requestApi);

    await expect(desktopFetch('/api/v1/auth/status')).resolves.toBe(original);
    await expect(desktopFetch('https://attacker.example/api/v1/artifacts')).resolves.toBe(original);
    expect(requestApi).not.toHaveBeenCalled();
    expect(baseFetch).toHaveBeenCalledTimes(2);
  });

  it('falls back to the original fetch when URL coercion fails', async () => {
    const original = new Response('original');
    const baseFetch = vi.fn().mockResolvedValue(original);
    const desktopFetch = createDesktopApiFetch(baseFetch as unknown as typeof fetch, vi.fn());
    const malformed = {
      toString() {
        throw new Error('invalid URL');
      },
    } as unknown as RequestInfo;

    await expect(desktopFetch(malformed)).resolves.toBe(original);
  });
});
