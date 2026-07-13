import { z } from 'zod';

const s = z
  .string()
  .optional()
  .transform((v) => v?.trim() || undefined);
const u = z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().url().optional());
const b = z.preprocess(
  (v) => (typeof v === 'string' ? ['true', '1'].includes(v.toLowerCase()) : v),
  z.boolean().default(false)
);
const optionalNumber = (schema: z.ZodNumber) =>
  z.preprocess((v) => {
    if (typeof v !== 'string') return v;
    const trimmed = v.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }, schema.optional());
const r = optionalNumber(z.number().min(0).max(1));

const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  BUN_TEST: s,
  EXPO_PUBLIC_API_URL: u,
  EXPO_PUBLIC_API_PORT: z.coerce.number().default(3000),
  EXPO_PUBLIC_FORCE_PROD_API: b,
  EXPO_PUBLIC_VOICE_GATEWAY_URL: u,
  EXPO_VERBOSE_STREAMING: b,
  EXPO_PUBLIC_DISABLE_E2E_SYNC: b,
  EXPO_PUBLIC_E2E_CHAT_ORDER_FIXTURE: b,
  EXPO_PUBLIC_ENABLE_E2E_AUTH_SEED: b,
  EXPO_PUBLIC_E2E_AUTH_TOKEN: s,
  EXPO_PUBLIC_E2E_AUTH_EMAIL: s,
  EXPO_PUBLIC_E2E_AUTH_USER_ID: s,
  EXPO_PUBLIC_E2E_AUTH_PLAN: s,
  EXPO_PUBLIC_E2E_AUTH_EXPIRES_AT: optionalNumber(z.number()),
  EXPO_PUBLIC_GOOGLE_CLIENT_ID: s,
  EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID: s,
  EXPO_PUBLIC_SENTRY_DSN: u,
  SENTRY_DSN: u,
  NEXT_PUBLIC_SENTRY_DSN: u,
  SENTRY_DISABLED: b,
  EXPO_PUBLIC_SENTRY_DISABLED: b,
  SENTRY_DEBUG: b,
  EXPO_PUBLIC_SENTRY_DEBUG: b,
  NEXT_PUBLIC_SENTRY_DEBUG: b,
  SENTRY_ENVIRONMENT: s,
  EXPO_PUBLIC_SENTRY_ENVIRONMENT: s,
  NEXT_PUBLIC_SENTRY_ENVIRONMENT: s,
  VERCEL_ENV: s,
  SENTRY_TRACES_SAMPLE_RATE: r,
  EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: r,
  SENTRY_PROFILES_SAMPLE_RATE: r,
  EXPO_PUBLIC_SENTRY_PROFILES_SAMPLE_RATE: r,
});

export type RawMobileEnv = z.infer<typeof baseSchema>;

export interface NormalizedMobileEnv {
  nodeEnv: 'development' | 'test' | 'production';
  api: {
    port: number;
    forceProd: boolean;
    baseUrl: string | undefined;
  };
  voiceGateway: {
    baseUrl: string | undefined;
  };
  google: {
    clientId: string | undefined;
    androidClientId: string | undefined;
  };
  flags: {
    verboseStreaming: boolean;
    bunTest: boolean;
    disableE2ESync: boolean;
    chatOrderFixture: boolean;
  };
  e2eAuthSeed: {
    enabled: boolean;
    accessToken: string | undefined;
    email: string | undefined;
    userId: string | undefined;
    plan: string | undefined;
    expiresAt: number | undefined;
  };
  sentry: {
    dsn: string | undefined;
    debug: boolean;
    disabled: boolean;
    environment: string;
    tracesSampleRate: number;
    profilesSampleRate: number;
  };
}

export const mobileEnvSchema = baseSchema.transform((v): NormalizedMobileEnv => {
  const ps = (...c: (string | undefined)[]) => c.find((x) => typeof x === 'string' && x.length > 0);
  const pn = (...c: (number | undefined)[]) => c.find((x) => typeof x === 'number');
  const dsn = ps(v.EXPO_PUBLIC_SENTRY_DSN, v.SENTRY_DSN, v.NEXT_PUBLIC_SENTRY_DSN);
  return {
    nodeEnv: v.NODE_ENV,
    api: {
      port: v.EXPO_PUBLIC_API_PORT,
      forceProd: v.EXPO_PUBLIC_FORCE_PROD_API,
      baseUrl: v.EXPO_PUBLIC_API_URL,
    },
    voiceGateway: {
      baseUrl: v.EXPO_PUBLIC_VOICE_GATEWAY_URL,
    },
    google: {
      clientId: v.EXPO_PUBLIC_GOOGLE_CLIENT_ID,
      androidClientId: v.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
    },
    flags: {
      verboseStreaming: v.EXPO_VERBOSE_STREAMING,
      bunTest: v.BUN_TEST === '1',
      disableE2ESync: v.EXPO_PUBLIC_DISABLE_E2E_SYNC,
      chatOrderFixture: v.EXPO_PUBLIC_E2E_CHAT_ORDER_FIXTURE,
    },
    e2eAuthSeed: {
      enabled: v.EXPO_PUBLIC_ENABLE_E2E_AUTH_SEED,
      accessToken: v.EXPO_PUBLIC_E2E_AUTH_TOKEN,
      email: v.EXPO_PUBLIC_E2E_AUTH_EMAIL,
      userId: v.EXPO_PUBLIC_E2E_AUTH_USER_ID,
      plan: v.EXPO_PUBLIC_E2E_AUTH_PLAN,
      expiresAt: v.EXPO_PUBLIC_E2E_AUTH_EXPIRES_AT,
    },
    sentry: {
      dsn,
      debug: !!(v.SENTRY_DEBUG || v.EXPO_PUBLIC_SENTRY_DEBUG || v.NEXT_PUBLIC_SENTRY_DEBUG),
      disabled: !!(v.SENTRY_DISABLED || v.EXPO_PUBLIC_SENTRY_DISABLED),
      environment:
        ps(
          v.SENTRY_ENVIRONMENT,
          v.EXPO_PUBLIC_SENTRY_ENVIRONMENT,
          v.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
          v.VERCEL_ENV
        ) || v.NODE_ENV,
      tracesSampleRate:
        pn(v.SENTRY_TRACES_SAMPLE_RATE, v.EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE) ?? 0,
      profilesSampleRate:
        pn(v.SENTRY_PROFILES_SAMPLE_RATE, v.EXPO_PUBLIC_SENTRY_PROFILES_SAMPLE_RATE) ?? 0,
    },
  };
});

export type MobileEnv = z.infer<typeof mobileEnvSchema>;

export const loadMobileEnv = (o: { env?: Record<string, string | undefined> } = {}): MobileEnv => {
  const src =
    o.env ||
    ((typeof process !== 'undefined' ? process.env : {}) as Record<string, string | undefined>);
  const res = mobileEnvSchema.safeParse(src); // coverage-ignore-line -- Bun reports this zod transform entry as uncovered despite direct tests.
  if (!res.success)
    throw new Error(
      `Mobile environment validation failed:\n${res.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`).join('\n')}`
    );
  return res.data;
};

export const ensureMobileGoogleClientId = (e: MobileEnv): string => {
  if (!e.google.clientId) throw new Error('EXPO_PUBLIC_GOOGLE_CLIENT_ID must be set');
  return e.google.clientId;
};
