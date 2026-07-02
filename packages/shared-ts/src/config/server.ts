import { z } from 'zod';

export type EnvSource = Record<string, string | undefined>;
const DEFAULT_AUTH_SECRET = 'development-fallback-auth-secret-32-chars!';
const AUTH_SECRET_PRODUCTION_ERROR =
  'AUTH_SECRET must be changed from the default value in production';

const TRUE_BOOLEAN_VALUES = new Set(['true', '1', 'yes', 'y']);
const FALSE_BOOLEAN_VALUES = new Set(['false', '0', 'no', 'n']);
const BOOLEAN_VALUE_ERROR = 'Expected boolean-like value (true/false/1/0/yes/no/y/n)';

const zBooleanString = z
  .string()
  .trim()
  .toLowerCase()
  .refine(
    (value) => TRUE_BOOLEAN_VALUES.has(value) || FALSE_BOOLEAN_VALUES.has(value),
    BOOLEAN_VALUE_ERROR
  )
  .transform((value) => TRUE_BOOLEAN_VALUES.has(value));

const zBoolean = z.union([z.boolean(), zBooleanString]).transform((value) => value);

const zBooleanWithDefault = (d: boolean) => zBoolean.default(d);

export const webEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL').optional(),
  AI_GATEWAY_API_KEY: z.string().optional(),
  VERCEL_AI_GATEWAY_URL: z.string().url().optional(),
  AUTH_SECRET: z.string().min(32).default(DEFAULT_AUTH_SECRET).optional().or(z.literal('')),
  AUTH_URL: z.string().url().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  DAYTONA_API_KEY: z.string().optional(),
  DAYTONA_JWT_TOKEN: z.string().optional(),
  DAYTONA_ORGANIZATION_ID: z.string().optional(),
  BRAVE_SEARCH_API_KEY: z.string().optional(),
  REDIS_URL: z.string().url().optional().or(z.literal('')),
  REDIS_KV_URL: z.string().url().optional().or(z.literal('')),
  DAYTONA_SANDBOX_POOL_SIZE: z.coerce.number().int().min(0).optional(),
  INNGEST_EVENT_KEY: z.string().optional(),
  INNGEST_SIGNING_KEY: z.string().optional(),
  INTERNAL_API_SECRET: z.string().min(32).optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRO_PRICE_ID: z.string().optional(),
  STRIPE_SUPER_PRICE_ID: z.string().optional(),
  REVENUECAT_SECRET_KEY: z.string().optional(),
  REVENUECAT_WEBHOOK_SECRET: z.string().optional(),
  REVENUECAT_ENTITLEMENT_PRO: z.string().optional().default('pro'),
  REVENUECAT_ENTITLEMENT_SUPER: z.string().optional().default('super'),
  APP_STORE_PRO_PRODUCT_ID: z.string().optional(),
  PLAY_STORE_PRO_PRODUCT_ID: z.string().optional(),
  APP_STORE_SUPER_PRODUCT_ID: z.string().optional(),
  PLAY_STORE_SUPER_PRODUCT_ID: z.string().optional(),
  ENABLE_PAYMENTS: zBooleanWithDefault(true),
  TASKFORCEAI_API_IN_MEMORY: zBooleanWithDefault(false),
  DISABLE_RATE_LIMITER_MEMORY_FALLBACK: zBooleanWithDefault(false),
  TASKFORCEAI_MOCK_ORCHESTRATION: zBooleanWithDefault(false),
  CACHE_HASH_ALGORITHM: z.enum(['sha1', 'sha256']).default('sha1'),
  TASKFORCEAI_ENABLE_PERF_BUFFER: zBooleanWithDefault(false),
  VERCEL: z.string().optional(),
  BUN_TEST: z.string().optional(),
  VITEST: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional(),
  RESEND_SUPPORT_EMAIL: z.string().optional(),
  TASKFORCEAI_DASHBOARD_URL: z.string().url().optional(),
  TASKFORCEAI_BILLING_URL: z.string().url().optional(),
  ENCRYPTION_KEY: z.string().optional(),
  ENCRYPTION_KEY_ACTIVE_VERSION: z.string().optional(),
  ALLOWED_ORIGINS: z.string().optional(),
  JWT_SECRET: z.string().optional(),
  LOG_LEVEL: z.string().optional(),
  OLLAMA_ENABLED: zBooleanWithDefault(false),
  OLLAMA_MODEL: z.string().optional(),
});

export type WebEnv = z.infer<typeof webEnvSchema>;

export interface LoadWebEnvOptions {
  env?: EnvSource;
  isTestEnv?: boolean;
  isBuildTime?: boolean;
  isClientSide?: boolean;
  skipValidation?: boolean;
  logger?: Pick<Console, 'warn'>;
}

const hasInvalidAuthSecretInProduction = (
  nodeEnv: string | undefined,
  authSecret: string | undefined
): boolean => nodeEnv === 'production' && (!authSecret || authSecret === DEFAULT_AUTH_SECRET);

const recoverWebEnvFromPartial = (src: EnvSource, issues: z.ZodIssue[]): WebEnv => {
  const candidate: EnvSource = { ...src };
  for (const issue of issues) {
    const key = issue.path[0];
    if (typeof key === 'string') {
      delete candidate[key];
    }
  }

  const recovered = webEnvSchema.safeParse(candidate);
  if (recovered.success) {
    return recovered.data;
  }

  // The schema recovery step deletes invalid keyed fields. This fallback is only for
  // future cross-field schema failures that cannot currently be constructed.
  // coverage-ignore-start
  return {
    NODE_ENV: (src['NODE_ENV'] as 'development' | 'test' | 'production') || 'development',
    DATABASE_URL: src['DATABASE_URL'] || '',
  } as unknown as WebEnv;
  // coverage-ignore-end
};

export const loadWebEnv = (opts: LoadWebEnvOptions = {}) => {
  const src =
    opts.env ??
    ((typeof process !== 'undefined' ? process.env : {}) as Record<string, string | undefined>);
  const isT = opts.isTestEnv ?? src['NODE_ENV'] === 'test';
  const isB = opts.isBuildTime ?? src['NEXT_PHASE'] === 'phase-production-build';
  const isC = opts.isClientSide ?? typeof window !== 'undefined';
  const val =
    (src['NODE_ENV'] === 'production' && !isC) || !(opts.skipValidation ?? (isT || isB || isC));
  const res = webEnvSchema.safeParse(src);
  const errors = res.success
    ? []
    : res.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);

  if (res.success && hasInvalidAuthSecretInProduction(res.data.NODE_ENV, res.data.AUTH_SECRET)) {
    errors.push(`AUTH_SECRET: ${AUTH_SECRET_PRODUCTION_ERROR}`);
  }

  if (errors.length > 0 && val)
    throw new Error(
      `Environment validation failed. Please review your configuration:\n${errors.join('\n')}`
    );
  if (!res.success && !val && src['NODE_ENV'] === 'development' && !isC)
    opts.logger?.warn('Environment validation failed outside runtime-critical paths', {
      errors: res.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });

  const env = res.success ? res.data : recoverWebEnvFromPartial(src, res.error.issues);

  return {
    env,
    validateEnv: (t: EnvSource = src) => {
      const c = webEnvSchema.safeParse(t);
      const validateErrors = c.success
        ? []
        : c.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);

      if (c.success && hasInvalidAuthSecretInProduction(c.data.NODE_ENV, c.data.AUTH_SECRET)) {
        validateErrors.push(`AUTH_SECRET: ${AUTH_SECRET_PRODUCTION_ERROR}`);
      }

      return validateErrors.length === 0
        ? { success: true as const }
        : {
            success: false as const,
            errors: validateErrors,
          };
    },
  };
};
