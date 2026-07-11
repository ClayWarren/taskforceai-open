'use client';

import React from 'react';

import { useRouter, useSearchParams } from '../../../components/routing';
import { verifyWebAuthenticatorMFALogin } from '../../../lib/auth/mfa-login';
import { logger } from '../../../lib/logger';
import { resolveLoginRedirectTarget } from '../../components/login-redirect';

export default function MFALoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const callbackUrl = searchParams.get('callbackUrl') ?? '/';
  const mfaToken = searchParams.get('mfa_token') ?? undefined;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedCode = code.trim();
    if (trimmedCode.length < 6) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await verifyWebAuthenticatorMFALogin(trimmedCode, mfaToken);
      const target = resolveLoginRedirectTarget(
        { callbackUrl: response.redirect_url ?? callbackUrl, error: null, plan: null },
        window.location.origin
      );
      window.location.assign(target);
    } catch (caught) {
      logger.warn('MFA login verification failed', { error: caught });
      setError('Invalid or expired authenticator code.');
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10 text-slate-100">
      <form
        className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-lg backdrop-blur"
        onSubmit={(event) => void submit(event)}
      >
        <div className="text-center">
          <h2 className="text-xl font-semibold">Multi-factor authentication</h2>
          <p className="mt-2 text-sm text-slate-400">Enter the code from your authenticator app.</p>
        </div>

        {error ? (
          <div
            id="mfa-login-error"
            role="alert"
            aria-live="assertive"
            className="rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-2 text-sm text-red-200"
          >
            {error}
          </div>
        ) : null}

        <label className="block text-sm font-medium text-slate-300" htmlFor="mfa-code">
          Authenticator code
          <input
            id="mfa-code"
            autoComplete="one-time-code"
            autoFocus
            inputMode="numeric"
            maxLength={6}
            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-center text-xl tracking-[0.35em] text-slate-100 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/40"
            value={code}
            onChange={(event) => setCode(event.currentTarget.value.replace(/\D/g, ''))}
          />
        </label>

        <button
          type="submit"
          disabled={busy}
          className="inline-flex w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 focus:ring-2 focus:ring-blue-500/70 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? 'Verifying...' : 'Continue'}
        </button>

        <button
          type="button"
          onClick={() => void router.push('/login')}
          className="w-full text-center text-xs text-slate-500 transition hover:text-slate-300"
        >
          Back to sign in
        </button>
      </form>
    </div>
  );
}
