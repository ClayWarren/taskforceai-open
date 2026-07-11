import { type Experimental_UseRealtimeOptions } from '@ai-sdk/react';
import {
  REALTIME_SETUP_ENDPOINT,
  RealtimeVoiceSetupPrefetchCache,
} from '@taskforceai/client-runtime';
import { getStoredToken } from '@taskforceai/api-client/auth/auth-storage';
import { getCsrfToken } from '@taskforceai/api-client/auth/csrf';

import { logger } from '../logger';

type RealtimeVoiceSetupPayload = Record<string, unknown> & {
  token?: unknown;
  expiresAt?: unknown;
};

const prefetchedRealtimeSetupCache =
  new RealtimeVoiceSetupPrefetchCache<RealtimeVoiceSetupPayload>();
let realtimeSetupPrefetchPromise: Promise<void> | null = null;

export const getRealtimeSetupRequestBody = (
  sessionConfig: Experimental_UseRealtimeOptions['sessionConfig']
): string => JSON.stringify({ sessionConfig });

const getCurrentOrigin = (): string => {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return 'http://localhost';
};

const isRealtimeSetupRequest = (input: RequestInfo | URL): boolean => {
  const currentOrigin = getCurrentOrigin();
  let url: URL;
  if (typeof input === 'string') {
    try {
      url = new URL(input, currentOrigin);
    } catch {
      return false;
    }
  } else if (input instanceof URL) {
    url = input;
  } else {
    try {
      url = new URL(input.url);
    } catch {
      return false;
    }
  }
  return url.origin === currentOrigin && url.pathname === REALTIME_SETUP_ENDPOINT;
};

const getRealtimeSetupCacheKey = (body: string, authBinding: string): string =>
  `${authBinding}\u001f${body}`;

const getRequestBodyString = (init?: RequestInit): string | null =>
  typeof init?.body === 'string' ? init.body : null;

type RealtimeFetchContext = {
  setupBody?: string;
};

const realtimeFetchContexts: RealtimeFetchContext[] = [];
let realtimeFetchBase: typeof fetch | null = null;
let realtimeFetchDispatcher: typeof fetch | null = null;

const consumePrefetchedRealtimeSetupResponse = async (
  body: string,
  authBinding: string | null
): Promise<Response | null> => {
  if (realtimeSetupPrefetchPromise) {
    await realtimeSetupPrefetchPromise.catch(() => undefined);
  }

  if (!authBinding) {
    return null;
  }

  const payload = prefetchedRealtimeSetupCache.consume(getRealtimeSetupCacheKey(body, authBinding));
  if (!payload) {
    return null;
  }

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'content-type': 'application/json',
    },
  });
};

const selectRealtimeFetchContext = (requestBody: string | null): RealtimeFetchContext | null => {
  if (requestBody) {
    for (let index = realtimeFetchContexts.length - 1; index >= 0; index -= 1) {
      const context = realtimeFetchContexts[index];
      if (context?.setupBody === requestBody) {
        return context;
      }
    }
  }

  return realtimeFetchContexts.at(-1) ?? null;
};

const createRealtimeFetchDispatcher = (baseFetch: typeof fetch): typeof fetch =>
  Object.assign(
    (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      if (!isRealtimeSetupRequest(input)) {
        return baseFetch(input, init);
      }

      const requestBody = getRequestBodyString(init);
      const context = selectRealtimeFetchContext(requestBody);
      const token = getStoredToken();
      if (context?.setupBody && requestBody === context.setupBody) {
        const prefetchedResponse = await consumePrefetchedRealtimeSetupResponse(
          context.setupBody,
          token.ok ? token.value : null
        );
        if (prefetchedResponse) {
          return prefetchedResponse;
        }
      }

      const csrfToken = await getCsrfToken();
      const headers = new Headers(init?.headers);
      if (csrfToken) {
        headers.set('X-CSRF-Token', csrfToken);
      }
      if (token.ok) {
        headers.set('authorization', `Bearer ${token.value}`);
      }
      return baseFetch(input, { ...init, headers });
    }) as typeof fetch, // coverage-ignore-line
    typeof baseFetch.preconnect === 'function'
      ? { preconnect: baseFetch.preconnect.bind(baseFetch) }
      : {}
  );

const acquireRealtimeFetchContext = (context: RealtimeFetchContext): (() => void) => {
  if (!realtimeFetchBase || globalThis.fetch !== realtimeFetchDispatcher) {
    realtimeFetchContexts.length = 0;
    realtimeFetchBase = globalThis.fetch;
    realtimeFetchDispatcher = createRealtimeFetchDispatcher(realtimeFetchBase);
    globalThis.fetch = realtimeFetchDispatcher;
  }

  realtimeFetchContexts.push(context);
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;

    const index = realtimeFetchContexts.lastIndexOf(context);
    if (index >= 0) {
      realtimeFetchContexts.splice(index, 1);
    }

    if (realtimeFetchContexts.length > 0) {
      return;
    }

    if (realtimeFetchBase && globalThis.fetch === realtimeFetchDispatcher) {
      globalThis.fetch = realtimeFetchBase;
    }
    realtimeFetchBase = null;
    realtimeFetchDispatcher = null;
  };
};

export const prewarmRealtimeVoiceSetup = (
  sessionConfig: Experimental_UseRealtimeOptions['sessionConfig']
): void => {
  if (typeof globalThis.fetch !== 'function') {
    return;
  }

  const body = getRealtimeSetupRequestBody(sessionConfig);
  const token = getStoredToken();
  if (!token.ok) {
    prefetchedRealtimeSetupCache.clear();
    return;
  }

  const cacheKey = getRealtimeSetupCacheKey(body, token.value);
  if (prefetchedRealtimeSetupCache.hasUsable(cacheKey)) {
    return;
  }
  if (realtimeSetupPrefetchPromise) {
    return;
  }

  realtimeSetupPrefetchPromise = (async () => {
    const csrfToken = await getCsrfToken();
    const headers = new Headers({
      'content-type': 'application/json',
    });
    if (csrfToken) {
      headers.set('X-CSRF-Token', csrfToken);
    }
    if (token.ok) {
      headers.set('authorization', `Bearer ${token.value}`);
    }

    const response = await fetch(REALTIME_SETUP_ENDPOINT, {
      method: 'POST',
      headers,
      body,
    });
    if (!response.ok) {
      return;
    }

    const payload = (await response.json()) as RealtimeVoiceSetupPayload;
    if (!payload || typeof payload !== 'object' || typeof payload.token !== 'string') {
      return;
    }

    prefetchedRealtimeSetupCache.store(cacheKey, payload);
  })()
    .catch((error) => {
      logger.debug('Realtime voice setup prewarm failed', { error });
    })
    .finally(() => {
      realtimeSetupPrefetchPromise = null;
    });
};

export const connectRealtimeWithCsrf = async (
  connect: () => Promise<void>,
  options: { setupBody?: string } = {}
): Promise<void> => {
  const csrfToken = await getCsrfToken();
  const token = getStoredToken();
  if (!csrfToken && !token.ok) {
    throw new Error('Sign in to use realtime voice.');
  }

  const releaseFetchContext = acquireRealtimeFetchContext({ setupBody: options.setupBody });
  try {
    await connect();
  } finally {
    releaseFetchContext();
  }
};

export const warmRealtimeVoiceSetup = () => {
  if (typeof globalThis.fetch?.preconnect === 'function') {
    try {
      globalThis.fetch.preconnect(REALTIME_SETUP_ENDPOINT);
    } catch (error) {
      logger.debug('Realtime voice preconnect failed', { error });
    }
  }

  void getCsrfToken().catch((error) => {
    logger.debug('Realtime voice CSRF prewarm failed', { error });
  });
};
