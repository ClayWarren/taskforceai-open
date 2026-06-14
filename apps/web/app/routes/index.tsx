import { createFileRoute } from '@tanstack/react-router';

import AppClient from '../app-shell/AppClient';

/**
 * Index route (/)
 *
 * This is the main app entry point for the product surface.
 * The AppClient component handles the full app shell with the chat interface.
 */
export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>) => {
    const plan = search['plan'];
    return {
      plan: plan === 'pro' || plan === 'super' ? plan : undefined,
    };
  },
  errorComponent: ({ reset }) => (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <h1>Something went wrong</h1>
      <button onClick={reset} style={{ marginTop: '1rem', padding: '0.5rem 1rem' }}>
        Retry
      </button>
    </div>
  ),
  component: HomePage,
});

function HomePage() {
  return <AppClient />;
}
