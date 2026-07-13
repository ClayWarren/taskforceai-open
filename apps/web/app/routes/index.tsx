import { createFileRoute } from '@tanstack/react-router';

import AppClient from '../app-shell/AppClient';
import { loadHomeBootstrap } from '../lib/bootstrap/app-shell-bootstrap';
import { RouteError } from './-route-error';

/**
 * Index route (/)
 *
 * This is the main app entry point for the product surface.
 * The AppClient component handles the full app shell with the chat interface.
 */
export const Route = createFileRoute('/')({
  loader: () => loadHomeBootstrap(),
  validateSearch: (search: Record<string, unknown>) => {
    const plan = search['plan'];
    return {
      plan: plan === 'pro' || plan === 'super' ? plan : undefined,
    };
  },
  errorComponent: RouteError,
  component: HomePage,
});

function HomePage() {
  const { modelSelector } = Route.useLoaderData();
  return <AppClient modelSelectorBootstrap={modelSelector} />;
}
