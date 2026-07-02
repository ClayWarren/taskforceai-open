import { vi } from 'bun:test';
import React, { type AnchorHTMLAttributes, type ReactNode } from 'react';

type RedirectOptions = {
  to: string;
  statusCode?: number;
  [key: string]: unknown;
};

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  children?: ReactNode;
  hash?: string;
  params?: Record<string, string>;
  preload?: boolean;
  to: string;
};

const redirectCalls: RedirectOptions[] = [];

const defaultCreateRouter = (options: unknown) => ({ options });

export const createRouterMock = vi.fn(defaultCreateRouter);

export class MockNotFoundError extends Error {
  constructor() {
    super('Not Found');
    this.name = 'MockNotFoundError';
  }
}

export function resolveRouterHref(
  to: string,
  params?: Record<string, string>,
  hash?: string
): string {
  let resolvedHref = to;

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      resolvedHref = resolvedHref.replace(`$${key}`, value);
    }
  }

  if (hash) {
    resolvedHref += hash.startsWith('#') ? hash : `#${hash}`;
  }

  return resolvedHref;
}

export function getMarketingRouterRedirects(): RedirectOptions[] {
  return [...redirectCalls];
}

export function resetMarketingRouterMock() {
  redirectCalls.length = 0;
  createRouterMock.mockReset();
  createRouterMock.mockImplementation(defaultCreateRouter);
}

function Link({ children, to, params, hash, preload, ...props }: LinkProps) {
  return React.createElement(
    'a',
    {
      ...props,
      href: resolveRouterHref(to, params, hash),
      'data-preload': preload === undefined ? undefined : String(preload),
      'data-router-hash': hash,
      'data-router-link': 'true',
      'data-router-to': to,
    },
    children
  );
}

function createFileRoute(_path: string) {
  return (options: Record<string, unknown>) => {
    let loaderData: unknown;

    return {
      options,
      useLoaderData: () => loaderData,
      __setLoaderData: (data: unknown) => {
        loaderData = data;
      },
    };
  };
}

export const tanstackRouterMock = {
  createFileRoute,
  createRootRoute: (options: Record<string, unknown>) => options,
  createRouter: createRouterMock,
  HeadContent: () => React.createElement('meta', { 'data-testid': 'head-content' }),
  Link,
  notFound: () => new MockNotFoundError(),
  Outlet: () =>
    React.createElement(
      'main',
      { 'data-testid': 'root-outlet' },
      React.createElement('div', { 'data-testid': 'router-outlet' }),
      React.createElement('div', { 'data-testid': 'help-outlet' })
    ),
  redirect: (options: RedirectOptions) => {
    redirectCalls.push(options);
    return new Error(`Redirect to ${options.to}`);
  },
  Scripts: () => React.createElement('script', { 'data-testid': 'router-scripts' }),
};

await vi.mock('@tanstack/react-router', () => tanstackRouterMock);
