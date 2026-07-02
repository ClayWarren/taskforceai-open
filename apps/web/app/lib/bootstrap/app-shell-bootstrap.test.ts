import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';
import { buildUserState } from '@taskforceai/contracts/auth/auth-service';
import { PUBLIC_MODEL_SELECTOR_CATALOG } from '@taskforceai/shared';

mock.restore();

const { resolveBootstrapOrigin } = await import('./app-shell-bootstrap-origin');
const { loadHomeBootstrapSnapshot, loadRootBootstrapSnapshot } =
  await import('./app-shell-bootstrap-snapshots');

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const readRequestUrl = (input: URL | RequestInfo): URL => {
  if (input instanceof URL) {
    return input;
  }
  if (input instanceof Request) {
    return new URL(input.url);
  }
  return new URL(input);
};

const readCookieHeader = (init?: RequestInit): string | null => {
  const headers = init?.headers;
  return headers instanceof Headers ? headers.get('cookie') : null;
};

const readAuthorizationHeader = (init?: RequestInit): string | null => {
  const headers = init?.headers;
  return headers instanceof Headers ? headers.get('authorization') : null;
};

const modelSelectorPayload = {
  enabled: true,
  options: [
    {
      id: 'sentinel-fast',
      label: 'Sentinel Fast',
      badge: 'Default',
      description: 'Fast model',
    },
  ],
  defaultModelId: 'sentinel-fast',
};

describe('web app shell bootstrap', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const bootstrapContext = () => ({
    origin: 'https://app.taskforceai.test',
    cookie: 'session=abc',
    fetchImpl: fetchMock as unknown as typeof fetch,
  });

  const publicBootstrapContext = () => ({
    origin: 'https://app.taskforceai.test',
    cookie: null,
    fetchImpl: fetchMock as unknown as typeof fetch,
  });

  const bearerBootstrapContext = () => ({
    origin: 'https://app.taskforceai.test',
    authorization: 'Bearer mobile-token',
    cookie: null,
    fetchImpl: fetchMock as unknown as typeof fetch,
  });

  it('loads authenticated root state server-side and forwards cookies', async () => {
    const profileUser = buildUserState({ id: 42, email: 'profile@example.com' });
    const forwardedCookies: Array<string | null> = [];
    fetchMock.mockImplementation((input: URL | RequestInfo, init?: RequestInit) => {
      const url = readRequestUrl(input);
      forwardedCookies.push(readCookieHeader(init));

      if (url.pathname === '/api/v1/auth/me') {
        return Promise.resolve(jsonResponse(profileUser));
      }
      if (url.pathname === '/api/auth/session') {
        return Promise.resolve(
          jsonResponse({ user: { email: 'session@example.com' }, expires: '2099-01-01' })
        );
      }
      throw new Error(`Unexpected bootstrap path ${url.pathname}`);
    });

    const result = await loadRootBootstrapSnapshot(bootstrapContext());

    expect(result.auth).toMatchObject({
      isAuthenticated: true,
      sessionStatus: 'authenticated',
      user: { email: 'profile@example.com' },
    });
    expect(forwardedCookies).toEqual(['session=abc', 'session=abc']);
  });

  it('loads authenticated root state from forwarded bearer auth', async () => {
    const profileUser = buildUserState({ id: 42, email: 'mobile@example.com' });
    const forwardedAuthorization: Array<string | null> = [];
    fetchMock.mockImplementation((input: URL | RequestInfo, init?: RequestInit) => {
      const url = readRequestUrl(input);
      forwardedAuthorization.push(readAuthorizationHeader(init));

      if (url.pathname === '/api/v1/auth/me') {
        return Promise.resolve(jsonResponse(profileUser));
      }
      if (url.pathname === '/api/auth/session') {
        return Promise.resolve(jsonResponse({ user: undefined }));
      }
      throw new Error(`Unexpected bootstrap path ${url.pathname}`);
    });

    const result = await loadRootBootstrapSnapshot(bearerBootstrapContext());

    expect(result.auth).toMatchObject({
      isAuthenticated: true,
      sessionStatus: 'authenticated',
      user: { email: 'mobile@example.com' },
    });
    expect(forwardedAuthorization).toEqual(['Bearer mobile-token', 'Bearer mobile-token']);
  });

  it('allows callers to use a longer auth bootstrap timeout for API routes', async () => {
    const profileUser = buildUserState({ id: 42, email: 'slow@example.com' });
    fetchMock.mockImplementation((input: URL | RequestInfo) => {
      const url = readRequestUrl(input);
      return new Promise<Response>((resolve) => {
        setTimeout(() => {
          if (url.pathname === '/api/v1/auth/me') {
            resolve(jsonResponse(profileUser));
            return;
          }
          resolve(jsonResponse({ user: undefined }));
        }, 20);
      });
    });

    const result = await loadRootBootstrapSnapshot({
      ...bearerBootstrapContext(),
      authTimeoutMs: 100,
    });

    expect(result.auth).toMatchObject({
      isAuthenticated: true,
      sessionStatus: 'authenticated',
      user: { email: 'slow@example.com' },
    });
  });

  it('returns an unauthenticated root snapshot when auth endpoints reject', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'unauthorized' }, 401));

    const result = await loadRootBootstrapSnapshot(bootstrapContext());

    expect(result.auth).toEqual({
      user: null,
      isAuthenticated: false,
      sessionStatus: 'unauthenticated',
    });
  });

  it('does not self-fetch auth endpoints for no-cookie public root bootstrap', async () => {
    const result = await loadRootBootstrapSnapshot(publicBootstrapContext());

    expect(result.auth).toEqual({
      user: null,
      isAuthenticated: false,
      sessionStatus: 'unauthenticated',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads model selector data for the home route', async () => {
    fetchMock.mockResolvedValue(jsonResponse(modelSelectorPayload));

    const result = await loadHomeBootstrapSnapshot(bootstrapContext());

    expect(result.modelSelector).toEqual(modelSelectorPayload);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('/api/v1/models', 'https://app.taskforceai.test/'),
      expect.objectContaining({ cache: 'no-store' })
    );
  });

  it('loads model selector data from forwarded bearer auth', async () => {
    fetchMock.mockImplementation((_input: URL | RequestInfo, init?: RequestInit) => {
      expect(readAuthorizationHeader(init)).toBe('Bearer mobile-token');
      return Promise.resolve(jsonResponse(modelSelectorPayload));
    });

    const result = await loadHomeBootstrapSnapshot(bearerBootstrapContext());

    expect(result.modelSelector).toEqual(modelSelectorPayload);
  });

  it('falls back to the public model catalog when the model endpoint is unavailable', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'unavailable' }, 503));

    const result = await loadHomeBootstrapSnapshot(bootstrapContext());

    expect(result.modelSelector).toEqual(PUBLIC_MODEL_SELECTOR_CATALOG);
  });

  it('does not self-fetch models for no-cookie public home bootstrap', async () => {
    const result = await loadHomeBootstrapSnapshot(publicBootstrapContext());

    expect(result.modelSelector).toEqual(PUBLIC_MODEL_SELECTOR_CATALOG);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not trust attacker-controlled request origins for credentialed self-fetches', () => {
    expect(
      resolveBootstrapOrigin('https://attacker.example', {
        VITE_SITE_URL: 'https://taskforceai.chat',
      })
    ).toBe('https://taskforceai.chat');
  });

  it('allows configured and local development bootstrap origins', () => {
    expect(
      resolveBootstrapOrigin('https://preview.taskforceai.chat', {
        VITE_SITE_URL: 'https://preview.taskforceai.chat',
      })
    ).toBe('https://preview.taskforceai.chat');
    expect(resolveBootstrapOrigin('http://localhost:3000', {})).toBe('http://localhost:3000');
  });
});
