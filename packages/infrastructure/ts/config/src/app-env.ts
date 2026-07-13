import { z, type ZodTypeAny } from 'zod';

import { commonClientEnvSchema, commonServerEnvSchema } from './base-env';

export type RuntimeEnvValue = string | undefined;

export type RuntimeEnvSource = Record<string, RuntimeEnvValue>;
type EnvSchema = Record<string, ZodTypeAny>;
type EmptyEnvSchema = Record<never, never>;
type InferEnv<TSchema extends EnvSchema> = { [TKey in keyof TSchema]: z.infer<TSchema[TKey]> };
type CommonServerEnv = InferEnv<typeof commonServerEnvSchema>;
type CommonNextPublicEnv = InferEnv<typeof commonClientEnvSchema>;
type ValidatedAppEnv<
  TBaseClient extends EnvSchema,
  TServer extends EnvSchema,
  TClient extends EnvSchema,
> = Readonly<CommonServerEnv & InferEnv<TBaseClient> & InferEnv<TServer> & InferEnv<TClient>>;

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

const readRuntimeEnv = (keys: readonly string[]): RuntimeEnvSource =>
  Object.fromEntries(keys.map((key) => [key, getRuntimeEnv(key)]));

const SERVER_ENV_KEYS = [
  'NODE_ENV',
  'PORT',
  'VERCEL',
  'VERCEL_URL',
  'SENTRY_DSN',
  'SENTRY_AUTH_TOKEN',
  'SENTRY_ORG',
  'SENTRY_PROJECT',
];
const CLIENT_ENV_SUFFIXES = [
  'SITE_URL',
  'AUTH_URL',
  'API_URL',
  'SENTRY_DSN',
  'MOBILE_IOS_APP_URL',
  'MOBILE_ANDROID_APP_URL',
  'APP_VERSION',
  'VERCEL_GIT_COMMIT_SHA',
  'STREAMING_DEBUG',
  'TAURI_FORCE_READY',
];
const readClientRuntimeEnv = (prefix: 'NEXT_PUBLIC_' | 'VITE_') =>
  readRuntimeEnv(CLIENT_ENV_SUFFIXES.map((suffix) => `${prefix}${suffix}`));

export const buildCommonServerRuntimeEnv = (): RuntimeEnvSource => readRuntimeEnv(SERVER_ENV_KEYS);

export const buildAuthRuntimeEnv = (): RuntimeEnvSource =>
  readRuntimeEnv(['AUTH_SECRET', 'AUTH_URL']);

export const buildNextPublicClientRuntimeEnv = (): RuntimeEnvSource =>
  readClientRuntimeEnv('NEXT_PUBLIC_');

export const buildViteClientRuntimeEnv = (extraEnv: RuntimeEnvSource = {}): RuntimeEnvSource => ({
  ...readClientRuntimeEnv('VITE_'),
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
  TBaseClient extends EnvSchema,
  TServer extends EnvSchema,
  TClient extends EnvSchema,
>(
  clientSchema: TBaseClient,
  runtimeEnv: RuntimeEnvSource,
  options: CreateAppEnvOptions<TServer, TClient>
) => ({
  server: {
    ...commonServerEnvSchema,
    ...options.server,
  },
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

const normalizeRuntimeEnv = (runtimeEnv: RuntimeEnvSource): RuntimeEnvSource =>
  Object.fromEntries(
    Object.entries(runtimeEnv).map(([key, value]) => [key, value === '' ? undefined : value])
  );

const createValidatedEnv = <
  TBaseClient extends EnvSchema,
  TServer extends EnvSchema,
  TClient extends EnvSchema,
>(
  clientSchema: TBaseClient,
  runtimeEnv: RuntimeEnvSource,
  options: CreateAppEnvOptions<TServer, TClient>
): ValidatedAppEnv<TBaseClient, TServer, TClient> => {
  const config = buildSharedEnvConfig(clientSchema, runtimeEnv, options);
  const normalizedRuntimeEnv = normalizeRuntimeEnv(config.runtimeEnv);
  if (config.skipValidation) {
    return Object.freeze(normalizedRuntimeEnv) as ValidatedAppEnv<TBaseClient, TServer, TClient>;
  }
  const schema = z.object({
    ...config.server,
    ...config.client,
  });
  return Object.freeze(schema.parse(normalizedRuntimeEnv)) as ValidatedAppEnv<
    TBaseClient,
    TServer,
    TClient
  >;
};

export const createNextPublicAppEnv = <
  TServer extends EnvSchema = EmptyEnvSchema,
  TClient extends EnvSchema = EmptyEnvSchema,
>(
  options: CreateAppEnvOptions<TServer, TClient> = {}
) =>
  createValidatedEnv(commonClientEnvSchema, buildNextPublicClientRuntimeEnv(), options) as Readonly<
    CommonServerEnv & CommonNextPublicEnv & InferEnv<TServer> & InferEnv<TClient>
  >;
