import { createFileRoute, redirect } from '@tanstack/react-router';
import { Suspense } from 'react';

import Login from '../../(auth)/components/Login';
import {
  parseLoginQuery,
  resolveLoginRedirectTarget,
} from '../../(auth)/components/login-redirect';
import { getWebAuthSession } from '../../lib/auth/session';
import { RouteError } from '../-route-error';

/**
 * Login route (/login)
 */
export const Route = createFileRoute('/login/')({
  beforeLoad: async ({ location }) => {
    if (typeof window === 'undefined') {
      return;
    }

    const session = await getWebAuthSession();
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
  errorComponent: RouteError,
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
