import {
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { ErrorBoundary } from '@taskforceai/ui-kit';
import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';

import AppClient from './app-shell/AppClient';
import './globals.css';
import { TauriReadySignal } from './lib/platform/TauriReadySignal';
import { Providers } from './lib/providers/RootProviders';

const rootRoute = createRootRoute({
  component: DesktopRoot,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: AppClient,
});

const indexHtmlRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/index.html',
  component: AppClient,
});

const authLoginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/api/v1/auth/login',
  component: DesktopAuthRedirectRecovery,
});

const routeTree = rootRoute.addChildren([indexRoute, indexHtmlRoute, authLoginRoute]);

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Desktop root element was not found.');
}

if (typeof window !== 'undefined') {
  (window as unknown as { __TASKFORCE_TAURI_READY?: boolean }).__TASKFORCE_TAURI_READY = true;
}

const router = createRouter({
  routeTree,
  scrollRestoration: true,
  defaultPreload: 'intent',
});

function DesktopRoot() {
  return (
    <>
      <TauriReadySignal />
      <ErrorBoundary>
        <Providers>
          <Outlet />
        </Providers>
      </ErrorBoundary>
    </>
  );
}

function DesktopAuthRedirectRecovery() {
  useEffect(() => {
    window.location.replace('/');
  }, []);

  return null;
}

createRoot(rootElement).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
