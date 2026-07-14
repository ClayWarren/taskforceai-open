import '@testing-library/jest-dom';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, mock, vi } from 'bun:test';

import '../../../../tests/setup/dom';

mock.restore();

const routeConfigs = new Map<string, any>();
const routeLoaderData = new Map<string, any>();
const appClientProps: any[] = [];
const homeBootstrap = {
  modelSelector: {
    enabled: true,
    options: [{ id: 'sentinel-fast', label: 'Sentinel Fast' }],
    defaultModelId: 'sentinel-fast',
  },
};
const loadHomeBootstrapMock = vi.fn(async () => homeBootstrap);

(globalThis as any).__TASKFORCEAI_ROUTE_WRAPPER_TEST_STATE__ = {
  routeConfigs,
  routeLoaderData,
  loadHomeBootstrap: loadHomeBootstrapMock,
};

mock.module('@tanstack/react-router', () => ({
  createFileRoute: vi.fn((path: string) => (config: any) => {
    const route = {
      ...config,
      useLoaderData: () => routeLoaderData.get(path) ?? {},
    };
    routeConfigs.set(path, route);
    return route;
  }),
}));

mock.module('../lib/bootstrap/app-shell-bootstrap', () => ({
  loadHomeBootstrap: loadHomeBootstrapMock,
}));

mock.module('../app-shell/AppClient', () => ({
  default: (props: unknown) => {
    appClientProps.push(props);
    return <div>App client</div>;
  },
}));

mock.module('../../(auth)/login/device/page', () => ({
  default: () => <div>Device login</div>,
}));

mock.module('../(auth)/login/device/page', () => ({
  default: () => <div>Device login</div>,
}));

mock.module('../../(auth)/login/mfa/page', () => ({
  default: () => <div>MFA login</div>,
}));

mock.module('../(auth)/login/mfa/page', () => ({
  default: () => <div>MFA login</div>,
}));

await import('./index');
await import('./login/device');
await import('./login/mfa');

describe('web route wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appClientProps.length = 0;
    routeLoaderData.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('validates home search params and renders app/error surfaces', () => {
    const homeRoute = routeConfigs.get('/');

    expect(homeRoute.validateSearch({ plan: 'pro' })).toEqual({ plan: 'pro' });
    expect(homeRoute.validateSearch({ plan: 'enterprise' })).toEqual({ plan: undefined });

    routeLoaderData.set('/', homeBootstrap);
    render(homeRoute.component());
    expect(screen.getByText('App client')).toBeInTheDocument();
    expect(appClientProps.at(-1)).toMatchObject({
      modelSelectorBootstrap: homeBootstrap.modelSelector,
    });

    const reset = vi.fn();
    render(homeRoute.errorComponent({ reset }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(reset).toHaveBeenCalled();
  });

  it('loads home bootstrap data through the route loader', async () => {
    const homeRoute = routeConfigs.get('/');

    await expect(homeRoute.loader()).resolves.toEqual(homeBootstrap);
    expect(loadHomeBootstrapMock).toHaveBeenCalled();
  });

  it('renders the device login route and retry surface', () => {
    const deviceRoute = routeConfigs.get('/login/device');

    render(deviceRoute.component());
    expect(screen.getByText('Device login')).toBeInTheDocument();

    const reset = vi.fn();
    render(deviceRoute.errorComponent({ reset }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(reset).toHaveBeenCalled();
  });

  it('validates MFA login search params and renders the MFA page', () => {
    const mfaRoute = routeConfigs.get('/login/mfa');

    expect(
      mfaRoute.validateSearch({
        callbackUrl: '/chat',
        mfa_token: 'token-1',
      })
    ).toEqual({ callbackUrl: '/chat', mfa_token: 'token-1' });
    expect(
      mfaRoute.validateSearch({
        callbackUrl: 42,
        mfa_token: null,
      })
    ).toEqual({ callbackUrl: undefined, mfa_token: undefined });

    render(mfaRoute.component());
    expect(screen.getByText('MFA login')).toBeInTheDocument();
  });
});
