import { createServerFn } from '@tanstack/react-start';
import { getRequest, getRequestUrl, setResponseHeader } from '@tanstack/react-start/server';

import { resolveBootstrapOrigin } from './app-shell-bootstrap-origin';
import {
  loadHomeBootstrapSnapshot,
  loadRootBootstrapSnapshot,
  type BootstrapRequestContext,
  type HomeBootstrapSnapshot,
  type RootBootstrapSnapshot,
} from './app-shell-bootstrap-snapshots';

export type { BootstrapRequestContext, HomeBootstrapSnapshot, RootBootstrapSnapshot };

const getRequestOrigin = (): string => {
  const requestUrl = getRequestUrl();
  return resolveBootstrapOrigin(requestUrl.origin);
};

const getForwardedCookie = (): string | null => {
  const cookie = getRequest().headers.get('cookie')?.trim();
  return cookie && cookie.length > 0 ? cookie : null;
};

const createBootstrapRequestContext = (): BootstrapRequestContext => ({
  origin: getRequestOrigin(),
  cookie: getForwardedCookie(),
  fetchImpl: fetch,
});

export const loadRootBootstrap = createServerFn({ method: 'GET' }).handler(
  async (): Promise<RootBootstrapSnapshot> => {
    const { auth } = await loadRootBootstrapSnapshot(createBootstrapRequestContext());
    setResponseHeader('cache-control', 'private, no-store');
    return { auth };
  }
);

export const loadHomeBootstrap = createServerFn({ method: 'GET' }).handler(
  async (): Promise<HomeBootstrapSnapshot> => {
    return loadHomeBootstrapSnapshot(createBootstrapRequestContext());
  }
);
