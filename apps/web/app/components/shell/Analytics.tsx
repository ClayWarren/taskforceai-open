'use client';

import { useEffect } from 'react';

import { hasAnalyticsConsent } from '@taskforceai/ui-kit/CookieBanner';

type VercelWindow = Window & {
  va?: (...params: unknown[]) => void;
  vaq?: unknown[][];
  vam?: string;
  si?: (...params: unknown[]) => void;
  siq?: unknown[][];
};

const ANALYTICS_SDK_NAME = '@vercel/analytics/react';
const ANALYTICS_SDK_VERSION = '2.0.1';
const SPEED_INSIGHTS_SDK_NAME = '@vercel/speed-insights/react';
const SPEED_INSIGHTS_SDK_VERSION = '2.0.0';

const getImportMetaEnv = (): { MODE?: string; DEV?: boolean } | undefined =>
  (import.meta as ImportMeta & { env?: { MODE?: string; DEV?: boolean } }).env;

const isDevelopmentMode = () => {
  const env = getImportMetaEnv();
  return env?.DEV === true || env?.MODE === 'development' || env?.MODE === 'test';
};

const appendScriptOnce = (src: string, dataset: Record<string, string>, onErrorMessage: string) => {
  const existingScript = Array.from(document.head.querySelectorAll('script')).some(
    (script) => script.getAttribute('src') === src
  );
  if (existingScript) return;

  const script = document.createElement('script');
  script.src = src;
  script.defer = true;
  for (const [key, value] of Object.entries(dataset)) {
    script.dataset[key] = value;
  }
  script.addEventListener('error', () => {
    console.log(onErrorMessage);
  });
  document.head.appendChild(script);
};

const initWebAnalytics = (win: VercelWindow) => {
  if (!win.va) {
    win.va = (...params: unknown[]) => {
      win.vaq ??= [];
      win.vaq.push(params);
    };
  }

  win.vam = isDevelopmentMode() ? 'development' : 'production';
  appendScriptOnce(
    isDevelopmentMode()
      ? 'https://va.vercel-scripts.com/v1/script.debug.js'
      : '/_vercel/insights/script.js',
    {
      sdkn: ANALYTICS_SDK_NAME,
      sdkv: ANALYTICS_SDK_VERSION,
    },
    '[Vercel Web Analytics] Failed to load analytics script.'
  );
};

const initSpeedInsights = (win: VercelWindow) => {
  if (!win.si) {
    win.si = (...params: unknown[]) => {
      win.siq ??= [];
      win.siq.push(params);
    };
  }

  appendScriptOnce(
    isDevelopmentMode()
      ? 'https://va.vercel-scripts.com/v1/speed-insights/script.debug.js'
      : '/_vercel/speed-insights/script.js',
    {
      sdkn: SPEED_INSIGHTS_SDK_NAME,
      sdkv: SPEED_INSIGHTS_SDK_VERSION,
    },
    '[Vercel Speed Insights] Failed to load speed insights script.'
  );
};

export function Analytics() {
  useEffect(() => {
    if (!hasAnalyticsConsent()) return;

    const win = window as VercelWindow;
    initWebAnalytics(win);
    initSpeedInsights(win);
  }, []);

  if (typeof window === 'undefined') return null;

  if (!hasAnalyticsConsent()) return null;

  return null;
}
