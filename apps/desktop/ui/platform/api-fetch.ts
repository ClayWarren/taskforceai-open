import type { AppServerApiRequestParams, AppServerApiRequestResult } from './app-server-types';
import { requestDesktopAppServerApi } from './app-server';

const desktopResources = new Set(['agents', 'artifacts', 'finances']);
const desktopApiHosts = new Set(['taskforceai.chat', 'www.taskforceai.chat']);

const requestUrl = (input: RequestInfo | URL): URL | null => {
  try {
    if (input instanceof Request) return new URL(input.url);
    if (input instanceof URL) return input;
    return new URL(input, 'tauri://localhost');
  } catch {
    return null;
  }
};

const isDesktopOrigin = (input: RequestInfo | URL, url: URL): boolean =>
  (typeof input === 'string' && input.startsWith('/')) ||
  url.protocol === 'tauri:' ||
  desktopApiHosts.has(url.hostname);

const desktopApiPath = (input: RequestInfo | URL): string | null => {
  const url = requestUrl(input);
  if (!url || !url.pathname.startsWith('/api/v1/')) return null;
  if (!isDesktopOrigin(input, url)) return null;
  const resource = url.pathname.slice('/api/v1/'.length).split('/', 1)[0];
  if (!resource || !desktopResources.has(resource)) return null;
  return `${url.pathname}${url.search}`;
};

const parseBody = async (input: RequestInfo | URL, init?: RequestInit): Promise<unknown> => {
  const body = init?.body ?? (input instanceof Request ? await input.clone().text() : null);
  if (body === null || body === undefined || body === '') return undefined;
  if (typeof body !== 'string') {
    throw new Error('Desktop API bridge only supports JSON request bodies.');
  }
  return JSON.parse(body) as unknown;
};

export const createDesktopApiFetch = (
  baseFetch: typeof fetch,
  requestApi: (
    params: AppServerApiRequestParams
  ) => Promise<AppServerApiRequestResult> = requestDesktopAppServerApi
): typeof fetch => {
  const desktopFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = requestUrl(input);
    if (url?.pathname === '/api/auth/csrf' && isDesktopOrigin(input, url)) {
      // The app-server owns the Desktop bearer token and performs its own CSRF exchange.
      // Web helpers may still request a browser CSRF cookie before a mutation; acknowledge
      // that request without exposing credentials to the WebView.
      return Response.json({});
    }
    const path = desktopApiPath(input);
    if (!path) return baseFetch(input, init);

    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    const body = await parseBody(input, init);
    const result = await requestApi({
      method,
      path,
      ...(body === undefined ? {} : { body }),
    });
    const hasBody = result.body !== undefined && result.body !== null && result.status !== 204;
    return new Response(hasBody ? JSON.stringify(result.body) : null, {
      status: result.status,
      headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
    });
  };
  return desktopFetch as typeof fetch;
};

let installed = false;

export const installDesktopApiFetch = (): void => {
  if (installed) return;
  globalThis.fetch = createDesktopApiFetch(globalThis.fetch.bind(globalThis));
  installed = true;
};
