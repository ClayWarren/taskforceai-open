import {
  ensureMobileGoogleClientId,
  loadMobileEnv,
} from '@taskforceai/config/mobile';

const ensureProcessEnv = (): void => {
  if (typeof process === 'undefined' || process.env) {
    return;
  }
  Object.defineProperty(process, 'env', {
    value: {},
    writable: true,
    configurable: true,
  });
};

ensureProcessEnv();

type ProcessEnv = Record<string, string | undefined>;
type GlobalWithProcess = typeof globalThis & {
  process?: {
    env?: ProcessEnv;
  };
};

const fallbackProcessEnv = ((globalThis as GlobalWithProcess).process?.env ?? {}) as ProcessEnv;
const shouldUseFallbackEnv = fallbackProcessEnv.JEST_WORKER_ID != null || fallbackProcessEnv.NODE_ENV === 'test';

/**
 * We must explicitly access process.env.EXPO_PUBLIC_* variables here
 * so that the Metro bundler can inline them at build time.
 * Dynamic access like process.env[key] does not work in React Native production builds.
 */
const readInlineMobileEnv = (): ProcessEnv => ({
  NODE_ENV: process.env.NODE_ENV,
  BUN_TEST: process.env.BUN_TEST,
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
  EXPO_PUBLIC_SYNC_URL: process.env.EXPO_PUBLIC_SYNC_URL,
  EXPO_PUBLIC_API_PORT: process.env.EXPO_PUBLIC_API_PORT,
  EXPO_PUBLIC_FORCE_PROD_API: process.env.EXPO_PUBLIC_FORCE_PROD_API,
  EXPO_PUBLIC_VOICE_GATEWAY_URL: process.env.EXPO_PUBLIC_VOICE_GATEWAY_URL,
  EXPO_VERBOSE_STREAMING: process.env.EXPO_VERBOSE_STREAMING,
  EXPO_PUBLIC_DISABLE_E2E_SYNC: process.env.EXPO_PUBLIC_DISABLE_E2E_SYNC,
  EXPO_PUBLIC_E2E_CHAT_ORDER_FIXTURE: process.env.EXPO_PUBLIC_E2E_CHAT_ORDER_FIXTURE,
  EXPO_PUBLIC_ENABLE_E2E_AUTH_SEED: process.env.EXPO_PUBLIC_ENABLE_E2E_AUTH_SEED,
  EXPO_PUBLIC_E2E_AUTH_TOKEN: process.env.EXPO_PUBLIC_E2E_AUTH_TOKEN,
  EXPO_PUBLIC_E2E_AUTH_EMAIL: process.env.EXPO_PUBLIC_E2E_AUTH_EMAIL,
  EXPO_PUBLIC_E2E_AUTH_USER_ID: process.env.EXPO_PUBLIC_E2E_AUTH_USER_ID,
  EXPO_PUBLIC_E2E_AUTH_PLAN: process.env.EXPO_PUBLIC_E2E_AUTH_PLAN,
  EXPO_PUBLIC_E2E_AUTH_EXPIRES_AT: process.env.EXPO_PUBLIC_E2E_AUTH_EXPIRES_AT,
  EXPO_PUBLIC_GOOGLE_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID,
  EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
  EXPO_PUBLIC_SENTRY_DSN: process.env.EXPO_PUBLIC_SENTRY_DSN,
  SENTRY_DSN: process.env.SENTRY_DSN,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  SENTRY_DISABLED: process.env.SENTRY_DISABLED,
  EXPO_PUBLIC_SENTRY_DISABLED: process.env.EXPO_PUBLIC_SENTRY_DISABLED,
  SENTRY_DEBUG: process.env.SENTRY_DEBUG,
  EXPO_PUBLIC_SENTRY_DEBUG: process.env.EXPO_PUBLIC_SENTRY_DEBUG,
  NEXT_PUBLIC_SENTRY_DEBUG: process.env.NEXT_PUBLIC_SENTRY_DEBUG,
  SENTRY_ENVIRONMENT: process.env.SENTRY_ENVIRONMENT,
  EXPO_PUBLIC_SENTRY_ENVIRONMENT: process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT,
  NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
  VERCEL_ENV: process.env.VERCEL_ENV,
  SENTRY_TRACES_SAMPLE_RATE: process.env.SENTRY_TRACES_SAMPLE_RATE,
  EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: process.env.EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
  SENTRY_PROFILES_SAMPLE_RATE: process.env.SENTRY_PROFILES_SAMPLE_RATE,
  EXPO_PUBLIC_SENTRY_PROFILES_SAMPLE_RATE: process.env.EXPO_PUBLIC_SENTRY_PROFILES_SAMPLE_RATE,
});

export const mobileEnv = loadMobileEnv({
  env: shouldUseFallbackEnv ? fallbackProcessEnv : readInlineMobileEnv(),
});

export const requireGoogleClientId = (): string => ensureMobileGoogleClientId(mobileEnv);
export const getGoogleAndroidClientId = (): string | undefined => mobileEnv.google.androidClientId;
