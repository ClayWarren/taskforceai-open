'use client';

import React, { useEffect, useState } from 'react';

import { useRouter, useSearchParams } from '../../components/routing';
import { authClient } from '@taskforceai/contracts/auth/auth-client';
import { useAuth } from '../../lib/providers/AuthProvider';
import { logger } from '../../lib/logger';
import {
  buildLoginCallbackUrl,
  getLoginErrorMessage,
  parseLoginQuery,
  resolveLoginRedirectTarget,
} from './login-redirect';

const Login: React.FC = () => {
  const [error, setError] = useState('');
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [devEmail, setDevEmail] = useState('local-dev@taskforceai.test');
  const searchParams = useSearchParams();
  const router = useRouter();
  const { isAuthenticated, refreshUser, sessionStatus } = useAuth();
  const localDevLoginEnabled =
    import.meta.env.DEV && import.meta.env.VITE_ENABLE_TEST_LOGIN === 'true';

  const redirectToSignIn = (callbackUrl: string | undefined) => {
    const safeCallback = callbackUrl ?? '/';
    window.location.assign(
      authClient.getSignInUrl({
        callbackUrl: safeCallback,
      })
    );
  };

  useEffect(() => {
    const loginQuery = parseLoginQuery(searchParams);
    const urlError = getLoginErrorMessage(loginQuery.error);
    if (urlError) {
      setError(urlError);
      setIsRedirecting(false);
      return;
    }

    setError('');

    if (sessionStatus === 'authenticated' && isAuthenticated) {
      void router.replace(resolveLoginRedirectTarget(loginQuery, window.location.origin));
      return;
    }

    if (
      sessionStatus === 'unauthenticated' &&
      !isAuthenticated &&
      !isRedirecting &&
      !error &&
      !localDevLoginEnabled
    ) {
      setIsRedirecting(true);
      // Safety timeout: if redirection doesn't happen in 10s, allow manual retry
      const timer = setTimeout(() => setIsRedirecting(false), 10000);

      try {
        redirectToSignIn(buildLoginCallbackUrl(loginQuery, window.location.origin));
      } catch (err: unknown) {
        clearTimeout(timer);
        logger.error('Login redirect failed', { error: err });
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(`Failed to start sign-in: ${message}`);
        setIsRedirecting(false);
      }

      return () => clearTimeout(timer);
    }

    return;
  }, [
    sessionStatus,
    isAuthenticated,
    searchParams,
    router,
    isRedirecting,
    error,
    localDevLoginEnabled,
  ]);

  const handleSignIn = () => {
    const loginQuery = parseLoginQuery(searchParams);
    setError('');
    setIsRedirecting(true);
    redirectToSignIn(buildLoginCallbackUrl(loginQuery, window.location.origin));
  };

  const handleLocalDevSignIn = async () => {
    const loginQuery = parseLoginQuery(searchParams);
    const email = devEmail.trim();
    if (!email) {
      setError('Enter an email for local sign-in.');
      return;
    }

    setError('');
    setIsRedirecting(true);
    try {
      const response = await fetch('/api/v1/auth/test-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(body?.detail || `Local sign-in failed (${response.status})`);
      }
      await refreshUser({ force: true });
      await router.replace(resolveLoginRedirectTarget(loginQuery, window.location.origin));
    } catch (err: unknown) {
      logger.error('Local dev login failed', { error: err });
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      setIsRedirecting(false);
    }
  };

  // Show loading while checking auth status or redirecting
  if (
    sessionStatus === 'loading' ||
    (sessionStatus === 'authenticated' && isAuthenticated) ||
    (isRedirecting && !error && !localDevLoginEnabled)
  ) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-100">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-slate-600 border-t-blue-500" />
          <p className="text-sm text-slate-400">
            {isRedirecting ? 'Redirecting to secure login...' : 'Loading...'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10 text-slate-100">
      <div className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-lg backdrop-blur">
        <div className="text-center">
          <h2 className="text-xl font-semibold">
            {error ? 'Login Error' : 'Sign in to TaskForceAI'}
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            {error
              ? 'We encountered an issue signing you in.'
              : 'Access your multi-agent orchestration platform.'}
          </p>
        </div>

        {error && (
          <div
            id="login-error"
            role="alert"
            aria-live="assertive"
            className="rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-2 text-sm text-red-200"
          >
            {error}
          </div>
        )}

        <div className="pt-2 text-center">
          <button
            type="button"
            id="login-btn"
            onClick={handleSignIn}
            className="inline-flex w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 focus:ring-2 focus:ring-blue-500/70 focus:outline-none"
          >
            {error ? 'Try Again' : 'Sign in with WorkOS'}
          </button>
          {localDevLoginEnabled && !error && (
            <div className="mt-4 space-y-3 border-t border-slate-800 pt-4">
              <label
                htmlFor="local-dev-email"
                className="block text-left text-xs font-medium text-slate-400"
              >
                Local dev email
              </label>
              <input
                id="local-dev-email"
                type="email"
                value={devEmail}
                onChange={(event) => setDevEmail(event.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/40 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void handleLocalDevSignIn()}
                className="inline-flex w-full items-center justify-center rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 focus:ring-2 focus:ring-emerald-500/70 focus:outline-none"
              >
                Continue locally
              </button>
            </div>
          )}
          {!error && (
            <button
              type="button"
              onClick={() => void router.push('/')}
              className="mt-4 text-xs text-slate-500 transition hover:text-slate-300"
            >
              Back to home
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default Login;
