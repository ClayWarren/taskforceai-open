import * as Sentry from '@sentry/react-native';

import { sanitizeEvent } from '@taskforceai/observability/sentry-config';

import { mobileEnv } from '../config/env';
import { mobileLogger } from '../logger';

let initialized = false;

export function initMobileSentry(): void {
  if (initialized) {
    return;
  }

  const {
    sentry: { dsn, disabled, debug, environment, tracesSampleRate, profilesSampleRate },
  } = mobileEnv;

  if (!dsn || disabled) {
    if (__DEV__) {
      mobileLogger.info('Sentry disabled for mobile client', {
        reason: !dsn ? 'missing_dsn' : 'env',
      });
    }
    return;
  }

  Sentry.init({
    dsn,
    debug,
    environment,
    enableAutoSessionTracking: true,
    enableNativeCrashHandling: true,
    tracesSampleRate,
    profilesSampleRate,
    // React Native SDK expects ErrorEvent; adapt sanitizeEvent to expected signature
    beforeSend: ((event: any) =>
      sanitizeEvent(event)) as any,
    integrations: (integrations) => [
      ...integrations,
      // ReactNativeTracing is deprecated in @sentry/react-native v7+
      // Tracing is now handled automatically
    ],
  });

  initialized = true;
  mobileLogger.info('Sentry initialized for mobile client');
}
