'use client';

import { FormEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useSearchParams } from '../../../components/routing';
import { authorizeDeviceLogin } from '../../../lib/auth/auth-actions';
import { getSignInUrl } from '../../../lib/auth/sign-in';
import { getWebAuthSession } from '../../../lib/auth/session';
import {
  DEVICE_ERROR_CLASSES,
  DEVICE_INPUT_CLASSES,
  DEVICE_PAGE_CARD_CLASSES,
  DEVICE_PAGE_CONTAINER_CLASSES,
  DEVICE_SUBMIT_BUTTON_CLASSES,
  DEVICE_SUCCESS_CLASSES,
} from './device-login-styles';
import { normalizeDeviceLoginCode, stripDeviceLoginCode } from './device-login-code';
import {
  deviceLoginSubmitLabel,
  isDeviceLoginSubmitDisabled,
  mapAuthorizeDeviceResponse,
} from './device-login-flow';

export function DeviceLoginContent() {
  const searchParams = useSearchParams();
  const isDesktopClient = searchParams.get('client') === 'desktop';
  const deviceLoginClient = isDesktopClient ? 'desktop' : 'terminal';
  const callbackUrl = useMemo(
    () => '/login/device' + (searchParams.toString() ? '?' + searchParams.toString() : ''),
    [searchParams]
  );
  const [codeInput, setCodeInput] = useState(() =>
    normalizeDeviceLoginCode(searchParams.get('code') ?? '')
  );
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState<string>('');
  const [isThrottled, setIsThrottled] = useState(false);
  const [isSessionReady, setIsSessionReady] = useState(false);
  const [isSessionChecking, setIsSessionChecking] = useState(true);
  const throttleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearThrottleTimeout = useCallback(() => {
    if (throttleTimeoutRef.current !== null) {
      clearTimeout(throttleTimeoutRef.current);
      throttleTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearThrottleTimeout();
    };
  }, [clearThrottleTimeout]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const session = await getWebAuthSession();
      if (cancelled) {
        return;
      }

      setIsSessionReady(Boolean(session?.user?.email));
      setIsSessionChecking(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [callbackUrl]);

  const handleSignIn = useCallback(() => {
    window.location.assign(getSignInUrl(callbackUrl));
  }, [callbackUrl]);

  const isSubmitDisabled = useMemo(
    () =>
      isDeviceLoginSubmitDisabled({
        status,
        isThrottled,
        isSessionChecking,
        isSessionReady,
        normalizedCodeLength: stripDeviceLoginCode(codeInput).length,
      }),
    [codeInput, isSessionChecking, isSessionReady, status, isThrottled]
  );

  const handleChange = useCallback((value: string) => {
    setCodeInput(normalizeDeviceLoginCode(value));
    setStatus('idle');
    setMessage('');
  }, []);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (isSubmitDisabled) {
        return;
      }
      setStatus('loading');
      setMessage('');
      setIsThrottled(true);
      clearThrottleTimeout();
      throttleTimeoutRef.current = setTimeout(() => {
        setIsThrottled(false);
        throttleTimeoutRef.current = null;
      }, 5000);

      const normalized = stripDeviceLoginCode(codeInput);

      const result = await authorizeDeviceLogin(normalized);
      const outcome = mapAuthorizeDeviceResponse(result, deviceLoginClient);
      setStatus(outcome.status);
      setMessage(outcome.message);
      if (outcome.sessionReady !== undefined) {
        setIsSessionReady(outcome.sessionReady);
      }
    },
    [clearThrottleTimeout, codeInput, deviceLoginClient, isSubmitDisabled]
  );

  return (
    <div className={DEVICE_PAGE_CONTAINER_CLASSES}>
      <div className={DEVICE_PAGE_CARD_CLASSES}>
        <h1 className="text-2xl font-semibold">
          {isDesktopClient ? 'Sign in to TaskForceAI Desktop' : 'Link your terminal'}
        </h1>
        <p className="mt-2 text-sm text-slate-300">
          {isDesktopClient
            ? 'Confirm the code from the TaskForceAI desktop app. You must be signed in with the account you want to use in the app.'
            : 'Enter the code shown in your TaskForceAI terminal window. You must be signed in with the account you want to link.'}{' '}
          Need to switch accounts?{' '}
          <button
            type="button"
            className="text-blue-400 underline hover:text-blue-300"
            onClick={handleSignIn}
          >
            Sign in
          </button>{' '}
          first.
        </p>

        <form
          className="mt-6 space-y-4"
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
        >
          <label className="block text-sm font-medium text-slate-200" htmlFor="device-code">
            Device code
          </label>
          <input
            id="device-code"
            name="device-code"
            value={codeInput}
            onChange={(event) => handleChange(event.target.value)}
            placeholder="ABCD-1234"
            autoCapitalize="characters"
            autoComplete="one-time-code"
            className={DEVICE_INPUT_CLASSES}
            inputMode="text"
            maxLength={9}
          />
          <button
            type="submit"
            disabled={isSubmitDisabled}
            className={DEVICE_SUBMIT_BUTTON_CLASSES}
          >
            {deviceLoginSubmitLabel({
              isSessionChecking,
              isSessionReady,
              status,
              client: deviceLoginClient,
            })}
          </button>
        </form>

        <div className="mt-6 text-sm text-slate-300">
          <p className="font-medium text-slate-200">How it works</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            {isDesktopClient ? (
              <>
                <li>Click Sign in from the TaskForceAI desktop app.</li>
                <li>We open this page automatically with your code.</li>
                <li>Authorize the code, then return to the desktop app.</li>
              </>
            ) : (
              <>
                <li>
                  Run <code className="rounded bg-slate-800 px-1 py-0.5">/login</code> in the
                  terminal client.
                </li>
                <li>We open this page automatically with your code.</li>
                <li>Paste the code, authorize, then return to the terminal.</li>
              </>
            )}
          </ol>
        </div>

        {status === 'success' && (
          <p className={DEVICE_SUCCESS_CLASSES}>{message || 'Login approved.'}</p>
        )}
        {status === 'error' && (
          <p className={DEVICE_ERROR_CLASSES}>{message || 'Authorization failed. Try again.'}</p>
        )}
      </div>
    </div>
  );
}

export default function DeviceLoginPage() {
  return (
    <Suspense
      fallback={
        <div className={DEVICE_PAGE_CONTAINER_CLASSES}>
          <div className={DEVICE_PAGE_CARD_CLASSES}>
            <p className="text-sm text-slate-300">Loading device login…</p>
          </div>
        </div>
      }
    >
      <DeviceLoginContent />
    </Suspense>
  );
}
