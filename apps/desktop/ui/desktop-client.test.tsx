import '@testing-library/jest-dom';

import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import type React from 'react';

import '../../../tests/setup/dom';

const addChildren = vi.fn((children: unknown[]) => ({ children, id: 'route-tree' }));
const rootRoute = { addChildren };
const createRootRoute = vi.fn((config: { component?: React.ComponentType } = {}) => ({
  ...rootRoute,
  config,
}));
const createRoute = vi.fn((config: any) => ({
  config,
  addChildren: vi.fn((children: unknown[]) => ({ config, children })),
}));
const createRouter = vi.fn((options: any) => ({ options, id: 'desktop-router' }));
const renderRoot = vi.fn();
const createRoot = vi.fn(() => ({ render: renderRoot }));
const replace = vi.fn();
const configureClientIdFactory = vi.fn();
const createId = vi.fn((prefix: string) => `${prefix}-test-id`);

vi.mock('@tanstack/react-router', () => ({
  createRootRoute,
  createRoute,
  createRouter,
  Outlet: () => <div data-testid="desktop-outlet" />,
  RouterProvider: ({ router }: { router: unknown }) => (
    <div data-testid="router-provider" data-router={JSON.stringify(router)} />
  ),
}));

vi.mock('@taskforceai/ui-kit/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="error-boundary">{children}</div>
  ),
}));

vi.mock('@taskforceai/client-runtime', () => ({
  configureClientIdFactory,
}));

vi.mock('@taskforceai/system-runtime/id', () => ({
  createId,
}));

vi.mock('react-dom/client', () => ({
  createRoot,
}));

vi.mock('@taskforceai/web/app/app-shell/AppClient', () => ({
  default: () => <div data-testid="app-client" />,
}));

vi.mock('@taskforceai/web/app/app-shell/ProductShellProviders', () => ({
  ProductShellProviders: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="product-shell-providers">{children}</div>
  ),
}));

vi.mock('@taskforceai/web/app/app-shell/StandaloneRouteShell', () => ({
  StandaloneRouteShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="standalone-route-shell">{children}</div>
  ),
}));

vi.mock('@taskforceai/web/app/components/plugins/PluginsPage', () => ({
  PluginsPage: () => <div data-testid="plugins-page" />,
}));

vi.mock('@taskforceai/web/app/routes/artifacts', () => ({
  ArtifactsPage: () => <div data-testid="artifacts-page" />,
}));

vi.mock('@taskforceai/web/app/routes/artifacts.$artifactId', () => ({
  ArtifactPage: () => <div data-testid="artifact-detail-page" />,
}));

vi.mock('@taskforceai/web/app/routes/finance', () => ({
  FinanceRoute: () => <div data-testid="finance-page" />,
}));

vi.mock('@taskforceai/web/app/routes/projects', () => ({
  ProjectsRoute: () => <div data-testid="projects-page" />,
}));

vi.mock('@taskforceai/web/app/routes/scheduled', () => ({
  ScheduledPage: () => <div data-testid="scheduled-page" />,
}));

vi.mock('./platform/TauriReadySignal', () => ({
  TauriReadySignal: () => <div data-testid="tauri-ready-signal" />,
}));

vi.mock('@taskforceai/web/app/lib/providers/RootProviders', () => ({
  Providers: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="root-providers">{children}</div>
  ),
}));

const importDesktopClient = () => import(`./desktop-client?test=${Date.now()}-${Math.random()}`);

const desktopRouteComponents = await import('./desktop-routes');

describe('desktop client bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '<div id="root"></div>';
    delete (window as unknown as { __TASKFORCE_TAURI_READY?: boolean }).__TASKFORCE_TAURI_READY;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { replace },
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('creates desktop routes, marks Tauri ready, and renders the router provider', async () => {
    await importDesktopClient();

    const routePaths = createRoute.mock.calls.map(([config]) => config.path);
    expect(routePaths).toEqual([
      '/',
      '/index.html',
      '/api/v1/auth/login',
      '/plugins',
      '/projects',
      '/scheduled',
      '/artifacts',
      '$artifactId',
      '/finance',
    ]);
    expect(addChildren).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ config: expect.objectContaining({ path: '/' }) }),
        expect.objectContaining({ config: expect.objectContaining({ path: '/index.html' }) }),
        expect.objectContaining({
          config: expect.objectContaining({ path: '/api/v1/auth/login' }),
        }),
        expect.objectContaining({ config: expect.objectContaining({ path: '/plugins' }) }),
        expect.objectContaining({ config: expect.objectContaining({ path: '/projects' }) }),
        expect.objectContaining({ config: expect.objectContaining({ path: '/scheduled' }) }),
        expect.objectContaining({ config: expect.objectContaining({ path: '/artifacts' }) }),
        expect.objectContaining({ config: expect.objectContaining({ path: '/finance' }) }),
      ])
    );
    expect(createRouter).toHaveBeenCalledWith({
      routeTree: { children: expect.any(Array), id: 'route-tree' },
      scrollRestoration: true,
      defaultPreload: 'intent',
    });
    expect(createRoot).toHaveBeenCalledWith(document.getElementById('root'));
    expect(renderRoot).toHaveBeenCalledTimes(1);
    expect(configureClientIdFactory).toHaveBeenCalledWith(createId);
    expect(
      (window as unknown as { __TASKFORCE_TAURI_READY?: boolean }).__TASKFORCE_TAURI_READY
    ).toBe(true);
  });

  it('throws when the desktop root element is missing', async () => {
    document.body.innerHTML = '';

    await expect(importDesktopClient()).rejects.toThrow('Desktop root element was not found.');
    expect(createRoot).not.toHaveBeenCalled();
  });

  it('renders the desktop root provider stack and redirects auth callback recovery to home', async () => {
    await importDesktopClient();

    const rootConfig = createRootRoute.mock.calls[0]?.[0];
    expect(rootConfig).toBeDefined();
    const RootComponent = desktopRouteComponents.DesktopRoot;
    const authRoute = createRoute.mock.calls.find(
      ([config]) => config.path === '/api/v1/auth/login'
    )?.[0];
    expect(authRoute).toBeDefined();
    const AuthRedirectRecovery = desktopRouteComponents.DesktopAuthRedirectRecovery;

    const { container, getByTestId } = render(<RootComponent />);
    const dragRegion = container.querySelector('[data-tauri-drag-region]');
    expect(dragRegion).toBeInTheDocument();
    expect(dragRegion).toHaveClass('z-[210]');
    expect(getByTestId('error-boundary')).toContainElement(getByTestId('root-providers'));
    expect(getByTestId('root-providers')).toContainElement(getByTestId('product-shell-providers'));
    expect(getByTestId('product-shell-providers')).toContainElement(getByTestId('desktop-outlet'));
    expect(getByTestId('tauri-ready-signal')).toBeInTheDocument();

    await act(async () => {
      render(<AuthRedirectRecovery />);
    });
    expect(replace).toHaveBeenCalledWith('/');
  });

  it('renders the plugins page without duplicating the root product shell', async () => {
    await importDesktopClient();

    const pluginsRoute = createRoute.mock.calls.find(([config]) => config.path === '/plugins')?.[0];
    expect(pluginsRoute).toBeDefined();
    const DesktopPluginsRoute = desktopRouteComponents.DesktopPluginsRoute;

    const { getByTestId, queryByTestId } = render(<DesktopPluginsRoute />);
    expect(queryByTestId('product-shell-providers')).toBeNull();
    expect(getByTestId('standalone-route-shell')).toContainElement(getByTestId('plugins-page'));
  });

  it('registers every primary sidebar destination with its real page component', async () => {
    await importDesktopClient();

    const destinations = [
      ['/projects', 'projects-page'],
      ['/scheduled', 'scheduled-page'],
      ['/artifacts', 'artifacts-page'],
      ['/finance', 'finance-page'],
    ] as const;

    for (const [path, testId] of destinations) {
      const route = createRoute.mock.calls.find(([config]) => config.path === path)?.[0];
      expect(route).toBeDefined();
      const Page = route?.component as React.ComponentType;
      const view = render(<Page />);
      expect(view.getByTestId(testId)).toBeInTheDocument();
      view.unmount();
    }
  });

  it('registers artifact detail navigation beneath the artifacts route', async () => {
    await importDesktopClient();

    const detailConfig = createRoute.mock.calls.find(
      ([config]) => config.path === '$artifactId'
    )?.[0];

    expect(detailConfig).toBeDefined();
    const artifactsRoute = detailConfig.getParentRoute() as {
      config: { path: string };
      addChildren: ReturnType<typeof vi.fn>;
    };
    expect(artifactsRoute.config.path).toBe('/artifacts');
    const DetailPage = detailConfig.component as React.ComponentType;
    expect(render(<DetailPage />).getByTestId('artifact-detail-page')).toBeInTheDocument();
    expect(artifactsRoute.addChildren).toHaveBeenCalledWith([
      expect.objectContaining({ config: expect.objectContaining({ path: '$artifactId' }) }),
    ]);
  });
});
