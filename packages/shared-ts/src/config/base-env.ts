import { z } from 'zod';

/**
 * Common client-side environment variables shared across all apps.
 * Must be prefixed with NEXT_PUBLIC_ to be exposed to the browser.
 */
export const commonClientEnvSchema = {
  NEXT_PUBLIC_SITE_URL: z.string().url().optional(),
  NEXT_PUBLIC_API_URL: z.string().url().optional(),
  NEXT_PUBLIC_AUTH_URL: z.string().url().optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
  NEXT_PUBLIC_MOBILE_IOS_APP_URL: z.string().url().optional(),
  NEXT_PUBLIC_MOBILE_ANDROID_APP_URL: z.string().url().optional(),
  NEXT_PUBLIC_APP_VERSION: z.string().optional(),
  NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: z.string().optional(),
  NEXT_PUBLIC_STREAMING_DEBUG: z.string().optional(),
  NEXT_PUBLIC_TAURI_FORCE_READY: z.string().optional(),
};

/**
 * Common Vite client-side environment variables shared across Vite-based apps.
 */
export const commonViteClientEnvSchema = {
  VITE_SITE_URL: z.string().url().optional(),
  VITE_API_URL: z.string().url().optional(),
  VITE_AUTH_URL: z.string().url().optional(),
  VITE_SENTRY_DSN: z.string().optional(),
  VITE_MOBILE_IOS_APP_URL: z.string().url().optional(),
  VITE_MOBILE_ANDROID_APP_URL: z.string().url().optional(),
  VITE_APP_VERSION: z.string().optional(),
  VITE_VERCEL_GIT_COMMIT_SHA: z.string().optional(),
  VITE_STREAMING_DEBUG: z.string().optional(),
  VITE_TAURI_FORCE_READY: z.string().optional(),
};

/**
 * Common server-side environment variables shared across all apps.
 */
export const commonServerEnvSchema = {
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.string().optional(),
  VERCEL: z.string().optional(),
  VERCEL_URL: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  SENTRY_AUTH_TOKEN: z.string().optional(),
  SENTRY_ORG: z.string().optional(),
  SENTRY_PROJECT: z.string().optional(),
};
