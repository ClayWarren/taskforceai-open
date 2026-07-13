import '@testing-library/jest-dom';

import { render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, mock, vi } from 'bun:test';
import type React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import '../../../../tests/setup/dom';

mock.restore();

const rootLoaderData = {
  auth: null,
};
const loadRootBootstrapMock = vi.fn(async () => rootLoaderData);
const getRouteWrapperTestState = () =>
  (globalThis as any).__TASKFORCEAI_ROUTE_WRAPPER_TEST_STATE__ as
    | {
        routeConfigs: Map<string, any>;
        routeLoaderData: Map<string, any>;
        loadHomeBootstrap: () => Promise<unknown>;
      }
    | undefined;
const getRootProvidersTestState = () =>
  (globalThis as any).__TASKFORCEAI_ROOT_PROVIDERS_TEST_STATE__ as
    | {
        isAuthenticated: boolean;
        isTokenReady: boolean;
        sdkKey?: string;
        user: { id: string; email?: string; plan?: string } | null;
        onInitialAuth?: (initialAuth: unknown) => void;
      }
    | undefined;

mock.module('@tanstack/react-router', () => ({
  createRootRoute: (options: any) => ({
    ...options,
    useLoaderData: () => rootLoaderData,
  }),
  createFileRoute: (path: string) => (config: any) => {
    const state = getRouteWrapperTestState();
    const route = {
      ...config,
      useLoaderData: () => state?.routeLoaderData.get(path) ?? {},
    };
    state?.routeConfigs.set(path, route);
    return route;
  },
  HeadContent: () => <meta data-testid="head-content" />,
  Outlet: () => <div data-testid="router-outlet" />,
  Scripts: () => <script data-testid="router-scripts" />,
}));

mock.module('../lib/bootstrap/app-shell-bootstrap', () => ({
  loadRootBootstrap: loadRootBootstrapMock,
  loadHomeBootstrap: () => getRouteWrapperTestState()?.loadHomeBootstrap(),
}));

mock.module('@taskforceai/config/app-env', () => ({
  getRuntimeEnv: (name: string) =>
    name === 'VITE_SITE_URL' ? 'https://app.taskforceai.example' : undefined,
}));

mock.module('@taskforceai/ui-kit/CookieBanner', () => ({
  CookieBanner: () => <div data-testid="cookie-banner" />,
}));

mock.module('@taskforceai/ui-kit/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="error-boundary">{children}</div>
  ),
}));

mock.module('@taskforceai/ui-kit/StructuredData', () => ({
  StructuredData: ({ siteUrl }: { siteUrl?: string }) => (
    <script data-testid="structured-data" data-site-url={siteUrl} />
  ),
}));

mock.module('../components/shell/Analytics', () => ({
  Analytics: () => <div data-testid="analytics" />,
}));

mock.module('../lib/platform/TauriReadySignal', () => ({
  TauriReadySignal: () => <div data-testid="tauri-ready-signal" />,
}));

mock.module('../lib/providers/RootProviders', () => ({
  Providers: ({ children, initialAuth }: { children: React.ReactNode; initialAuth?: unknown }) => (
    <RootProvidersMock initialAuth={initialAuth}>{children}</RootProvidersMock>
  ),
}));

function RootProvidersMock({
  children,
  initialAuth,
}: {
  children: React.ReactNode;
  initialAuth?: unknown;
}) {
  const state = getRootProvidersTestState();
  state?.onInitialAuth?.(initialAuth);
  const isAuthenticated = state?.isAuthenticated ?? true;
  const isTokenReady = state?.isTokenReady ?? true;
  const user = state?.user ?? null;
  const sdkKey = state?.sdkKey;

  let content = <div data-testid="streaming-provider">{children}</div>;
  if (isAuthenticated && user && sdkKey) {
    content = (
      <div data-sdk-key={sdkKey} data-testid="feature-flag-provider" data-user-id={user.id}>
        {content}
      </div>
    );
  }
  if (isAuthenticated && isTokenReady) {
    content = <div data-testid="sync-provider">{content}</div>;
  }

  return (
    <div data-has-initial-auth={initialAuth ? 'true' : 'false'} data-testid="root-providers">
      <div data-has-initial-auth={initialAuth ? 'true' : 'false'} data-testid="auth-provider">
        {content}
      </div>
    </div>
  );
}

let RootRoute: any;

beforeAll(async () => {
  ({ Route: RootRoute } = await import('./__root'));
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('web root route', () => {
  it('exports product metadata with absolute Open Graph assets', () => {
    const head = RootRoute.head();

    expect(head.meta).toContainEqual({ title: 'TaskForceAI' });
    expect(head.meta).toContainEqual({
      name: 'description',
      content:
        'Multi-agent AI orchestration platform powered by Sentinel, our core high-reasoning layer. Intelligent task decomposition and synthesis through parallel agent execution.',
    });
    expect(head.meta).toContainEqual({
      property: 'og:url',
      content: 'https://app.taskforceai.example',
    });
    expect(head.meta).toContainEqual({
      property: 'og:image',
      content: 'https://app.taskforceai.example/api/og',
    });
    expect(head.links).toContainEqual({ rel: 'manifest', href: '/manifest.json' });
  });

  it('renders shell providers, analytics, structured data, and router outlet', () => {
    const RootLayout = RootRoute.component as React.ComponentType;
    const html = renderToStaticMarkup(<RootLayout />);

    expect(html).toContain('data-testid="head-content"');
    expect(html).toContain('data-testid="structured-data"');
    expect(html).toContain('data-site-url="https://app.taskforceai.example"');
    expect(html).toContain('data-testid="tauri-ready-signal"');
    expect(html).toContain('src="/prompt-draft-capture.js"');
    expect(html).not.toContain('__TASKFORCEAI_PROMPT_DRAFT__');
    expect(html).toContain('data-testid="error-boundary"');
    expect(html).toContain('data-testid="root-providers"');
    expect(html).toContain('data-has-initial-auth="false"');
    expect(html).toContain('data-testid="router-outlet"');
    expect(html).toContain('data-testid="cookie-banner"');
    expect(html).toContain('data-testid="analytics"');
    expect(html).toContain('data-testid="router-scripts"');
  });

  it('loads root bootstrap data through the route loader', async () => {
    await RootRoute.loader();

    expect(loadRootBootstrapMock).toHaveBeenCalled();
  });

  it('renders a not-found recovery page', () => {
    const NotFound = RootRoute.notFoundComponent as React.ComponentType;

    render(<NotFound />);

    expect(screen.getByRole('heading', { level: 1, name: '404' })).toBeInTheDocument();
    expect(screen.getByText('Page not found.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to home' }).getAttribute('href')).toBe('/');
  });
});
