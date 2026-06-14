import { buildUserState } from '@taskforceai/contracts/auth/auth-service';

import { resolveSessionExpiryMs } from './token-expiry';
import { mobileLogger } from '../logger';
import { sqliteStorage } from '../storage/sqlite-adapter';

type E2EAuthSeed = {
  accessToken: string;
  email: string;
  userId: string;
  plan: 'free' | 'pro' | 'super' | 'admin';
  expiresAt?: number;
};

declare const __DEV__: boolean | undefined;

const parsePlan = (plan: string | undefined): E2EAuthSeed['plan'] => {
  return plan === 'pro' || plan === 'super' || plan === 'admin' ? plan : 'free';
};

const parseExpiresAt = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const readProcessEnvValue = (read: () => string | undefined): string | undefined => {
  try {
    if (typeof process === 'undefined') {
      return undefined;
    }
    return read();
  } catch {
    return undefined;
  }
};

const getEnv = (): Record<string, string | undefined> => {
  return {
    NODE_ENV: readProcessEnvValue(() => process.env.NODE_ENV),
    EXPO_PUBLIC_ENABLE_E2E_AUTH_SEED: readProcessEnvValue(
      () => process.env.EXPO_PUBLIC_ENABLE_E2E_AUTH_SEED
    ),
    EXPO_PUBLIC_E2E_AUTH_TOKEN: readProcessEnvValue(
      () => process.env.EXPO_PUBLIC_E2E_AUTH_TOKEN
    ),
    EXPO_PUBLIC_E2E_AUTH_EMAIL: readProcessEnvValue(
      () => process.env.EXPO_PUBLIC_E2E_AUTH_EMAIL
    ),
    EXPO_PUBLIC_E2E_AUTH_USER_ID: readProcessEnvValue(
      () => process.env.EXPO_PUBLIC_E2E_AUTH_USER_ID
    ),
    EXPO_PUBLIC_E2E_AUTH_PLAN: readProcessEnvValue(() => process.env.EXPO_PUBLIC_E2E_AUTH_PLAN),
    EXPO_PUBLIC_E2E_AUTH_EXPIRES_AT: readProcessEnvValue(
      () => process.env.EXPO_PUBLIC_E2E_AUTH_EXPIRES_AT
    ),
  };
};

export const canUseE2EAuthSeed = (
  env: Record<string, string | undefined> = getEnv()
): boolean => {
  if (env.EXPO_PUBLIC_ENABLE_E2E_AUTH_SEED !== '1') {
    return false;
  }
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    return true;
  }
  return env.NODE_ENV === 'test';
};

export const readE2EAuthSeed = (): E2EAuthSeed | null => {
  const env = getEnv();
  if (!canUseE2EAuthSeed(env)) {
    return null;
  }

  const accessToken = env.EXPO_PUBLIC_E2E_AUTH_TOKEN?.trim();
  const email = env.EXPO_PUBLIC_E2E_AUTH_EMAIL?.trim();
  if (!accessToken || !email) {
    return null;
  }

  return {
    accessToken,
    email,
    userId: env.EXPO_PUBLIC_E2E_AUTH_USER_ID?.trim() || email,
    plan: parsePlan(env.EXPO_PUBLIC_E2E_AUTH_PLAN),
    expiresAt: parseExpiresAt(env.EXPO_PUBLIC_E2E_AUTH_EXPIRES_AT),
  };
};

export const seedE2EAuthSession = async (): Promise<boolean> => {
  const seed = readE2EAuthSeed();
  if (!seed) {
    return false;
  }

  const expiresAt = resolveSessionExpiryMs(seed.accessToken, seed.expiresAt);
  const numericUserId = Number(seed.userId);
  const userProfile = buildUserState({
    id: Number.isFinite(numericUserId) ? numericUserId : 0,
    email: seed.email,
    plan: seed.plan,
  });

  const [sessionResult, profileResult] = await Promise.all([
    sqliteStorage.setSession({
      accessToken: seed.accessToken,
      expiresAt,
      user: {
        id: seed.userId,
        email: seed.email,
        plan: seed.plan,
      },
    }),
    sqliteStorage.saveProfile(userProfile),
  ]);

  if (!sessionResult.ok) {
    throw sessionResult.error;
  }
  if (!profileResult.ok) {
    throw profileResult.error;
  }

  mobileLogger.info('[E2EAuthSeed] Seeded simulator auth session', {
    email: seed.email,
    plan: seed.plan,
    expiresAt,
  });
  return true;
};
