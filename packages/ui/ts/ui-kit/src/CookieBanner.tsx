'use client';

import React from 'react';
import { getAuthLogger } from '@taskforceai/api-client/auth/logger';

import { reloadPage } from '@taskforceai/browser-runtime/browser-actions';
import { readCookieValue, setCookieSafely } from '@taskforceai/browser-runtime/cookies';

const COOKIE_NAME = 'taskforceai-cookie-consent';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
const logger = getAuthLogger();

export function CookieBanner() {
  const [mounted, setMounted] = React.useState(false);
  const [isVisible, setIsVisible] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  React.useEffect(() => {
    if (!mounted) {
      return;
    }
    const cookie = readCookieValue(COOKIE_NAME);
    setIsVisible(!(cookie.ok && cookie.value));
  }, [mounted]);

  if (!mounted || !isVisible) return null;

  const handleConsent = (value: 'true' | 'false') => {
    const result = setCookieSafely(
      `${COOKIE_NAME}=${value}; path=/; max-age=${ONE_YEAR_SECONDS}; SameSite=Lax`
    );
    if (!result.ok) {
      logger.error('Failed to set cookie consent', { error: result.error });
      return;
    }
    setIsVisible(false);
    const reload = reloadPage();
    if (!reload.ok) {
      logger.error('Failed to reload after cookie choice', { error: reload.error });
    }
  };

  return (
    <div
      data-testid="cookie-banner"
      style={{
        background: 'rgba(0, 0, 0, 0.95)',
        backdropFilter: 'blur(10px)',
        borderTop: '1px solid rgba(255, 255, 255, 0.1)',
        padding: '20px',
        fontSize: '14px',
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 40,
      }}
    >
      <div className="mx-auto flex max-w-4xl flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-white/90">
          We use cookies to enhance your experience. Essential cookies are required for the site to
          function. Analytics cookies help us improve our service.{' '}
          <a
            href="/privacy"
            style={{ color: '#3b82f6', textDecoration: 'underline' }}
            target="_blank"
            rel="noopener noreferrer"
          >
            Learn more about cookie privacy
          </a>
        </p>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <button
            onClick={() => handleConsent('true')}
            style={{
              background: '#2563eb',
              color: 'white',
              fontSize: '14px',
              padding: '10px 20px',
              borderRadius: '6px',
              border: 'none',
              cursor: 'pointer',
              fontWeight: '500',
            }}
          >
            Accept All
          </button>
          <button
            onClick={() => handleConsent('false')}
            style={{
              background: 'transparent',
              color: 'rgba(255, 255, 255, 0.7)',
              fontSize: '14px',
              padding: '10px 20px',
              borderRadius: '6px',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              cursor: 'pointer',
              fontWeight: '500',
            }}
          >
            Reject Non-Essential
          </button>
        </div>
      </div>
    </div>
  );
}
/**
 * Check if user has given cookie consent
 */
export function hasAnalyticsConsent(): boolean {
  const cookie = readCookieValue(COOKIE_NAME);
  if (!cookie.ok) {
    return false;
  }
  return cookie.value === 'true';
}
