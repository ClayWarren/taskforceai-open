import { type ApiClient, createApiClient } from '@taskforceai/api-client/client';
import type { TokenResult } from '@taskforceai/api-client';
import { err, ok } from '@taskforceai/client-core/result';

import { type AuthClient, createAuthClient } from '@taskforceai/api-client/auth';

import { getMobileBaseUrl } from '../config/base-url';
import { createModuleLogger } from '../logger';
import { mobileMetrics } from '../observability/metrics';
import { createPinnedFetch } from '../security/certificate-pinning';
import { sqliteStorage } from '../storage/sqlite-adapter';

declare global {
  // eslint-disable-next-line no-var
  var __MOBILE_CLIENTS__: {
    api: ApiClient | null;
    auth: AuthClient | null;
    pinnedFetch: typeof fetch | null;
  } | undefined;
}

const getGlobalClients = () => {
  if (typeof globalThis === 'undefined') return { api: null, auth: null, pinnedFetch: null };
  if (!globalThis.__MOBILE_CLIENTS__) {
    globalThis.__MOBILE_CLIENTS__ = { api: null, auth: null, pinnedFetch: null };
  }
  return globalThis.__MOBILE_CLIENTS__;
};

const getCachedApiClient = () => getGlobalClients().api;
const setCachedApiClient = (c: ApiClient | null) => { getGlobalClients().api = c; };
const getCachedAuthClient = () => getGlobalClients().auth;
const setCachedAuthClient = (c: AuthClient | null) => { getGlobalClients().auth = c; };
const getCachedPinnedFetch = () => getGlobalClients().pinnedFetch;
const setCachedPinnedFetch = (f: typeof fetch | null) => { getGlobalClients().pinnedFetch = f; };

const logger = createModuleLogger('MobileApiClient');

const resolveTokenFromStorage = async (): Promise<TokenResult> => {
  try {
    const sessionRes = await sqliteStorage.getSession();
    if (sessionRes.ok) {
      return ok(sessionRes.value.accessToken);
    }
    return err('TOKEN_MISSING');
  } catch {
    return err('TOKEN_UNAVAILABLE');
  }
};

const resolveBaseUrl = () => {
  const url = getMobileBaseUrl();
  logger.debug('Resolved base URL', { url });
  return url;
};

/**
 * Shared pinned fetch instance for all mobile network traffic.
 *
 * API clients and auth token exchange should both go through this helper to
 * ensure production domain and pin guards are always applied.
 */
export const getMobilePinnedFetch = (): typeof fetch => {
  let fetchImpl = getCachedPinnedFetch();
  if (!fetchImpl) {
    fetchImpl = createPinnedFetch();
    setCachedPinnedFetch(fetchImpl);
  }
  return fetchImpl;
};

const buildApiClient = (): ApiClient => {
  const url = resolveBaseUrl();
  logger.info('Creating API client', { url });
  return createApiClient({
    baseUrl: url,
    defaultHeaders: {
      'User-Agent': 'TaskForceAI-Mobile',
    },
    getToken: async () => resolveTokenFromStorage(),
    fetchImpl: getMobilePinnedFetch(),
    metrics: mobileMetrics,
  });
};

const buildAuthClient = (apiClient: ApiClient): AuthClient =>
  createAuthClient({
    apiClient,
    storage: {
      getSession: () => sqliteStorage.getSession(),
      setSession: (session) => sqliteStorage.setSession(session),
      clearSession: () => sqliteStorage.clearSession(),
      getToken: async () => {
        const res = await sqliteStorage.getSession();
        return res.ok ? ok(res.value.accessToken) : err(new Error('No token'));
      },
    },
  });

/**
 * Get or create the shared mobile API client instance.
 *
 * Bug #4 fix: the previous `_apiClientInitializing` flag was misleading.
 * `buildApiClient` is synchronous, so in single-threaded JS the
 * `if (cached) return cached` guard below is already sufficient — by the time
 * a second synchronous caller reaches this function, the first has already
 * stored its result in the cache. A flag that only guarded against an
 * impossible concurrent write added noise and emitted spurious warnings.
 * If `buildApiClient` ever becomes async, a proper promise-based mutex will
 * be needed at that point.
 */
export const getMobileClient = (): ApiClient => {
  const cached = getCachedApiClient();
  if (cached) return cached;

  const api = buildApiClient();
  setCachedApiClient(api);
  return api;
};

/**
 * Get or create the mobile AuthClient (shared auth module).
 * Same reasoning as getMobileClient: synchronous construction makes
 * the simple cache-check guard sufficient.
 */
export const getMobileAuthClient = (): AuthClient => {
  const cached = getCachedAuthClient();
  if (cached) return cached;

  const auth = buildAuthClient(getMobileClient());
  setCachedAuthClient(auth);
  return auth;
};
