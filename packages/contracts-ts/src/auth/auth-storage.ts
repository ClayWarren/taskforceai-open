'use client';

import type { AuthenticatedUser } from '@taskforceai/contracts/contracts';
import { parseJsonSchema } from '@taskforceai/shared/json/parse';
import { type Result, err, ok } from '@taskforceai/shared/result';
import { z } from 'zod';

import {
  readStorageItem,
  removeStorageItem,
  writeStorageItem,
} from '@taskforceai/shared/utils/browser-storage';
import { setCookieSafely } from '@taskforceai/shared/utils/cookies';
import { isServerSide } from '../utils/ssr-guards';
import { getAuthLogger } from './logger';

const hasTauriRuntime = (): boolean => typeof window !== 'undefined' && '__TAURI__' in window;

// Fallback desktop sync adapter if not provided
const getDesktopSyncAdapter = () => ({
  syncAuthToken: (_token: string | null) => {
    if (hasTauriRuntime()) {
      // Logic for syncing with Tauri if needed
    }
  },
});

const AUTH_USER_KEY = 'authUser';
const AUTH_TOKEN_KEY = 'authToken';
const COOKIE_NAME = 'auth-user';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60;
const logger = getAuthLogger();
let inMemoryAuthToken: string | null = null;
const taskforceDomain = 'taskforceai.chat';

const normalizeHostname = (hostname: string): string =>
  hostname.trim().toLowerCase().replace(/\.+$/, '');

const isTaskforceCookieHost = (hostname: string): boolean => {
  const normalized = normalizeHostname(hostname);
  return normalized === taskforceDomain || normalized.endsWith(`.${taskforceDomain}`);
};

const isLocalDevelopmentHost = (hostname: string): boolean => {
  const normalized = normalizeHostname(hostname);
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '[::1]';
};

const getCookieDomainAttribute = () => {
  if (typeof window === 'undefined') return '';
  const hostname = window.location.hostname;
  if (isTaskforceCookieHost(hostname)) {
    return '; Domain=.taskforceai.chat';
  }
  return '';
};

const getSecureFlag = () => {
  if (typeof window === 'undefined') return '';
  const hostname = window.location.hostname;
  const isSecure = !isLocalDevelopmentHost(hostname);
  return isSecure ? '; Secure' : '';
};

const writeAuthCookie = (value: string) => {
  const result = setCookieSafely(value);
  if (!result.ok) {
    logger.warn('Failed to set auth cookie', { error: result.error });
  }
};

// Zod schema for validating stored user data
const partialAuthenticatedUserSchema = z
  .object({
    id: z.number().optional(),
    email: z.string().optional(),
    tier: z.enum(['FREE', 'PRO', 'ENTERPRISE']).optional(),
    createdAt: z.string().optional(),
  })
  .passthrough();

type UserStorageError = 'NOT_FOUND' | 'PARSE_ERROR' | 'NO_WINDOW';

export const loadStoredUser = (): Result<Partial<AuthenticatedUser>, UserStorageError> => {
  if (isServerSide()) {
    return err('NO_WINDOW');
  }
  const storedResult = readStorageItem(AUTH_USER_KEY);
  if (!storedResult.ok) {
    return err('NOT_FOUND');
  }
  const parsed = parseJsonSchema(storedResult.value, partialAuthenticatedUserSchema);
  if (!parsed.ok) {
    logger.warn('Failed to validate stored user data', { error: parsed.error });
    return err('PARSE_ERROR');
  }
  return ok(parsed.value as Partial<AuthenticatedUser>);
};

export const storeUser = (user: AuthenticatedUser) => {
  if (typeof window !== 'undefined') {
    const result = writeStorageItem(AUTH_USER_KEY, JSON.stringify(user));
    if (!result.ok) {
      logger.error('Failed to store user item', { error: result.error });
      return result;
    }
  }
  const domain = getCookieDomainAttribute();
  const secure = getSecureFlag();
  writeAuthCookie(
    `${COOKIE_NAME}=${encodeURIComponent(user.email)}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax${domain}${secure}`
  );
  return ok(true);
};

export const clearStoredUser = () => {
  inMemoryAuthToken = null;
  if (typeof window !== 'undefined') {
    removeStorageItem(AUTH_USER_KEY);
    removeStorageItem(AUTH_TOKEN_KEY);
  }
  getDesktopSyncAdapter().syncAuthToken(null);
  const domain = getCookieDomainAttribute();
  const secure = getSecureFlag();
  writeAuthCookie(
    `${COOKIE_NAME}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax${domain}${secure}`
  );
};

export const storeAuthToken = (token: string) => {
  inMemoryAuthToken = token;
  // Clear legacy persisted token to avoid browser-resting credential storage.
  removeStorageItem(AUTH_TOKEN_KEY);
  getDesktopSyncAdapter().syncAuthToken(token);
};

export const clearAuthToken = () => {
  inMemoryAuthToken = null;
  removeStorageItem(AUTH_TOKEN_KEY);
  getDesktopSyncAdapter().syncAuthToken(null);
};

type TokenStorageError = 'NOT_FOUND' | 'NO_WINDOW';

export const getStoredToken = (): Result<string, TokenStorageError> => {
  if (inMemoryAuthToken && inMemoryAuthToken.length > 0) {
    return ok(inMemoryAuthToken);
  }
  if (isServerSide()) {
    return err('NO_WINDOW');
  }

  // One-time migration path for existing clients that still have a token persisted
  // from older builds. We move it into memory and erase the persisted copy.
  const legacyToken = readStorageItem(AUTH_TOKEN_KEY);
  if (legacyToken.ok) {
    const normalizedToken = legacyToken.value.trim();
    if (normalizedToken.length === 0) {
      removeStorageItem(AUTH_TOKEN_KEY);
      return err('NOT_FOUND');
    }
    inMemoryAuthToken = normalizedToken;
    removeStorageItem(AUTH_TOKEN_KEY);
    return ok(normalizedToken);
  }

  return err('NOT_FOUND');
};
