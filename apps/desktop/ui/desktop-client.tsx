import { RouterProvider, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { configureClientIdFactory } from '@taskforceai/client-runtime';
import { createId } from '@taskforceai/system-runtime/id';
import React from 'react';
import { createRoot } from 'react-dom/client';

import AppClient from '@taskforceai/web/app/app-shell/AppClient';
import { ArtifactsPage } from '@taskforceai/web/app/routes/artifacts';
import { ArtifactPage } from '@taskforceai/web/app/routes/artifacts.$artifactId';
import { FinanceRoute } from '@taskforceai/web/app/routes/finance';
import { ProjectsRoute } from '@taskforceai/web/app/routes/projects';
import { ScheduledPage } from '@taskforceai/web/app/routes/scheduled';
import '@taskforceai/web/app/globals.css';
import { installDesktopIntegrations } from './desktop-integration';
import { DesktopAuthRedirectRecovery, DesktopPluginsRoute, DesktopRoot } from './desktop-routes';

configureClientIdFactory(createId);
installDesktopIntegrations();

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

const pluginsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/plugins',
  component: DesktopPluginsRoute,
});

const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects',
  component: ProjectsRoute,
});

const scheduledRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/scheduled',
  component: ScheduledPage,
});

const artifactsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/artifacts',
  component: ArtifactsPage,
});

const artifactDetailRoute = createRoute({
  getParentRoute: () => artifactsRoute,
  path: '$artifactId',
  component: ArtifactPage,
});

const financeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/finance',
  component: FinanceRoute,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  indexHtmlRoute,
  authLoginRoute,
  pluginsRoute,
  projectsRoute,
  scheduledRoute,
  artifactsRoute.addChildren([artifactDetailRoute]),
  financeRoute,
]);

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

createRoot(rootElement).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
