import { buildUserState } from '@taskforceai/api-client/auth/auth-service';

import { resolveSessionExpiryMs } from '@taskforceai/api-client/auth/session-expiry';
import { mobileEnv } from '../config/env';
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

type E2EAuthSeedEnv = typeof mobileEnv;

export const canUseE2EAuthSeed = (
  env: E2EAuthSeedEnv = mobileEnv
): boolean => {
  if (!env.e2eAuthSeed.enabled) {
    return false;
  }
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    return true;
  }
  return env.nodeEnv === 'test';
};

export const readE2EAuthSeed = (): E2EAuthSeed | null => {
  if (!canUseE2EAuthSeed(mobileEnv)) {
    return null;
  }

  const accessToken = mobileEnv.e2eAuthSeed.accessToken?.trim();
  const email = mobileEnv.e2eAuthSeed.email?.trim();
  if (!accessToken || !email) {
    return null;
  }

  return {
    accessToken,
    email,
    userId: mobileEnv.e2eAuthSeed.userId?.trim() || email,
    plan: parsePlan(mobileEnv.e2eAuthSeed.plan),
    expiresAt: mobileEnv.e2eAuthSeed.expiresAt,
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
