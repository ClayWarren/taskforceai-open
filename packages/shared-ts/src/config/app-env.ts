import { createEnv } from '@t3-oss/env-core';
import { z, type ZodTypeAny } from 'zod';

import {
  commonClientEnvSchema,
  commonServerEnvSchema,
  commonViteClientEnvSchema,
} from './base-env';

export type RuntimeEnvValue = string | undefined;

export type RuntimeEnvSource = Record<string, RuntimeEnvValue>;
type EnvSchema = Record<string, ZodTypeAny>;
type EmptyEnvSchema = Record<never, never>;
type InferEnv<TSchema extends EnvSchema> = { [TKey in keyof TSchema]: z.infer<TSchema[TKey]> };
type CommonServerEnv = InferEnv<typeof commonServerEnvSchema>;
type CommonNextPublicEnv = InferEnv<typeof commonClientEnvSchema>;
type CommonViteEnv = InferEnv<typeof commonViteClientEnvSchema>;

const readImportMetaEnv = (): RuntimeEnvSource | undefined => {
  if (typeof import.meta === 'undefined') {
    // coverage-ignore-line
    return undefined; // coverage-ignore-line
  }

  return (import.meta as ImportMeta & { env?: RuntimeEnvSource }).env;
};

export const getRuntimeEnv = (key: string): RuntimeEnvValue => {
  if (typeof process !== 'undefined' && process.env && process.env[key] !== undefined) {
    return process.env[key];
  }

  const importMetaEnv = readImportMetaEnv();
  if (importMetaEnv && importMetaEnv[key] !== undefined) {
    return importMetaEnv[key]; // coverage-ignore-line -- Bun does not reliably attribute import.meta.env reads.
  }

  const browserProcessEnv =
    typeof window !== 'undefined'
      ? (window as { process?: { env?: RuntimeEnvSource } }).process?.env
      : undefined;
  if (browserProcessEnv && browserProcessEnv[key] !== undefined) {
    return browserProcessEnv[key];
  }

  return undefined;
};

export const buildCommonServerRuntimeEnv = (): RuntimeEnvSource => ({
  NODE_ENV: getRuntimeEnv('NODE_ENV'),
  PORT: getRuntimeEnv('PORT'),
  VERCEL: getRuntimeEnv('VERCEL'),
  VERCEL_URL: getRuntimeEnv('VERCEL_URL'),
  SENTRY_DSN: getRuntimeEnv('SENTRY_DSN'),
  SENTRY_AUTH_TOKEN: getRuntimeEnv('SENTRY_AUTH_TOKEN'),
  SENTRY_ORG: getRuntimeEnv('SENTRY_ORG'),
  SENTRY_PROJECT: getRuntimeEnv('SENTRY_PROJECT'),
});

export const buildAuthRuntimeEnv = (): RuntimeEnvSource => ({
  AUTH_SECRET: getRuntimeEnv('AUTH_SECRET'),
  AUTH_URL: getRuntimeEnv('AUTH_URL'),
});

export const buildNextPublicClientRuntimeEnv = (): RuntimeEnvSource => ({
  NEXT_PUBLIC_SITE_URL: getRuntimeEnv('NEXT_PUBLIC_SITE_URL'),
  NEXT_PUBLIC_AUTH_URL: getRuntimeEnv('NEXT_PUBLIC_AUTH_URL'),
  NEXT_PUBLIC_API_URL: getRuntimeEnv('NEXT_PUBLIC_API_URL'),
  NEXT_PUBLIC_SENTRY_DSN: getRuntimeEnv('NEXT_PUBLIC_SENTRY_DSN'),
  NEXT_PUBLIC_MOBILE_IOS_APP_URL: getRuntimeEnv('NEXT_PUBLIC_MOBILE_IOS_APP_URL'),
  NEXT_PUBLIC_MOBILE_ANDROID_APP_URL: getRuntimeEnv('NEXT_PUBLIC_MOBILE_ANDROID_APP_URL'),
  NEXT_PUBLIC_APP_VERSION: getRuntimeEnv('NEXT_PUBLIC_APP_VERSION'),
  NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: getRuntimeEnv('NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA'),
  NEXT_PUBLIC_STREAMING_DEBUG: getRuntimeEnv('NEXT_PUBLIC_STREAMING_DEBUG'),
  NEXT_PUBLIC_TAURI_FORCE_READY: getRuntimeEnv('NEXT_PUBLIC_TAURI_FORCE_READY'),
});

export const buildViteClientRuntimeEnv = (extraEnv: RuntimeEnvSource = {}): RuntimeEnvSource => ({
  VITE_SITE_URL: getRuntimeEnv('VITE_SITE_URL'),
  VITE_AUTH_URL: getRuntimeEnv('VITE_AUTH_URL'),
  VITE_API_URL: getRuntimeEnv('VITE_API_URL'),
  VITE_SENTRY_DSN: getRuntimeEnv('VITE_SENTRY_DSN'),
  VITE_MOBILE_IOS_APP_URL: getRuntimeEnv('VITE_MOBILE_IOS_APP_URL'),
  VITE_MOBILE_ANDROID_APP_URL: getRuntimeEnv('VITE_MOBILE_ANDROID_APP_URL'),
  VITE_APP_VERSION: getRuntimeEnv('VITE_APP_VERSION'),
  VITE_VERCEL_GIT_COMMIT_SHA: getRuntimeEnv('VITE_VERCEL_GIT_COMMIT_SHA'),
  VITE_STREAMING_DEBUG: getRuntimeEnv('VITE_STREAMING_DEBUG'),
  VITE_TAURI_FORCE_READY: getRuntimeEnv('VITE_TAURI_FORCE_READY'),
  ...extraEnv,
});

export const shouldSkipEnvValidation = (): boolean =>
  getRuntimeEnv('NODE_ENV') === 'test' ||
  getRuntimeEnv('NEXT_PHASE') === 'phase-production-build' ||
  getRuntimeEnv('BUN_TEST') === '1';

interface CreateAppEnvOptions<
  TServer extends EnvSchema = EmptyEnvSchema,
  TClient extends EnvSchema = EmptyEnvSchema,
> {
  server?: TServer;
  client?: TClient;
  runtimeEnv?: RuntimeEnvSource;
  skipValidation?: boolean;
}

const buildSharedEnvConfig = <
  TClientPrefix extends 'NEXT_PUBLIC_' | 'VITE_',
  TBaseClient extends EnvSchema,
  TServer extends EnvSchema,
  TClient extends EnvSchema,
>(
  clientPrefix: TClientPrefix,
  clientSchema: TBaseClient,
  runtimeEnv: RuntimeEnvSource,
  options: CreateAppEnvOptions<TServer, TClient>
) => ({
  server: {
    ...commonServerEnvSchema,
    ...options.server,
  },
  clientPrefix,
  client: {
    ...clientSchema,
    ...options.client,
  },
  runtimeEnv: {
    ...buildCommonServerRuntimeEnv(),
    ...runtimeEnv,
    ...options.runtimeEnv,
  },
  skipValidation: options.skipValidation ?? shouldSkipEnvValidation(),
  emptyStringAsUndefined: true,
});

export const createNextPublicAppEnv = <
  TServer extends EnvSchema = EmptyEnvSchema,
  TClient extends EnvSchema = EmptyEnvSchema,
>(
  options: CreateAppEnvOptions<TServer, TClient> = {}
) =>
  createEnv(
    buildSharedEnvConfig(
      'NEXT_PUBLIC_',
      commonClientEnvSchema,
      buildNextPublicClientRuntimeEnv(),
      options
    ) as any
  ) as Readonly<CommonServerEnv & CommonNextPublicEnv & InferEnv<TServer> & InferEnv<TClient>>;

export const createViteAppEnv = <
  TServer extends EnvSchema = EmptyEnvSchema,
  TClient extends EnvSchema = EmptyEnvSchema,
>(
  options: CreateAppEnvOptions<TServer, TClient> = {}
) =>
  createEnv(
    buildSharedEnvConfig(
      'VITE_',
      commonViteClientEnvSchema,
      buildViteClientRuntimeEnv(),
      options
    ) as any
  ) as Readonly<CommonServerEnv & CommonViteEnv & InferEnv<TServer> & InferEnv<TClient>>;
