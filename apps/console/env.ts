import { buildAuthRuntimeEnv, createNextPublicAppEnv } from '@taskforceai/shared/config/app-env';
import { z } from 'zod';

type ConsoleEnv = Readonly<{
  NODE_ENV: 'development' | 'test' | 'production';
  PORT?: string;
  VERCEL?: string;
  VERCEL_URL?: string;
  SENTRY_DSN?: string;
  SENTRY_AUTH_TOKEN?: string;
  SENTRY_ORG?: string;
  SENTRY_PROJECT?: string;
  AUTH_SECRET?: string;
  AUTH_URL?: string;
  NEXT_PUBLIC_SITE_URL?: string;
  NEXT_PUBLIC_API_URL?: string;
  NEXT_PUBLIC_AUTH_URL?: string;
  NEXT_PUBLIC_SENTRY_DSN?: string;
  NEXT_PUBLIC_MOBILE_IOS_APP_URL?: string;
  NEXT_PUBLIC_MOBILE_ANDROID_APP_URL?: string;
  NEXT_PUBLIC_APP_VERSION?: string;
  NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?: string;
  NEXT_PUBLIC_STREAMING_DEBUG?: string;
  NEXT_PUBLIC_TAURI_FORCE_READY?: string;
}>;

/**
 * Web app environment variables.
 *
 * All env vars accessed in the web app should be defined here.
 * This provides runtime validation and TypeScript types.
 *
 * @see https://env.t3.gg/docs/core
 */
export const env: ConsoleEnv = createNextPublicAppEnv({
  server: {
    AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
    AUTH_URL: z.string().url().optional(),
  },
  runtimeEnv: {
    ...buildAuthRuntimeEnv(),
  },
}) as ConsoleEnv;
