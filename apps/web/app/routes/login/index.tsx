import { createFileRoute, redirect } from '@tanstack/react-router';
import { Suspense } from 'react';

import Login from '../../(auth)/components/Login';
import {
  parseLoginQuery,
  resolveLoginRedirectTarget,
} from '../../(auth)/components/login-redirect';
import { authClient } from '@taskforceai/contracts/auth/auth-client';

/**
 * Login route (/login)
 */
export const Route = createFileRoute('/login/')({
  beforeLoad: async ({ location }) => {
    if (typeof window === 'undefined') {
      return;
    }

    const session = await authClient.getSession();
    if (session?.user?.email) {
      const query = parseLoginQuery(new URLSearchParams(location.search));
      const target = resolveLoginRedirectTarget(query, window.location.origin);
      throw redirect({ href: target });
    }
  },
  validateSearch: (search: Record<string, unknown>) => {
    const plan = search['plan'];
    return {
      callbackUrl: typeof search['callbackUrl'] === 'string' ? search['callbackUrl'] : undefined,
      error: typeof search['error'] === 'string' ? search['error'] : undefined,
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
  component: LoginPage,
});

function LoginPage() {
  return (
    <Suspense
      fallback={
        <div role="status" aria-live="polite">
          Loading sign-in form...
        </div>
      }
    >
      <Login />
    </Suspense>
  );
}
