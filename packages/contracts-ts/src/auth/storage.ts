/**
 * Shared Auth Storage Interface
 *
 * Abstract storage layer for cross-platform auth token management
 */
import { z } from 'zod';

import { parseJsonSchema } from '@taskforceai/shared/json/parse';
import { type Result, err, ok } from '@taskforceai/shared/result';
import { getAuthLogger } from './logger';
import type { AuthenticatedUser, SessionData } from './types';

const logger = getAuthLogger();

/**
 * Platform-agnostic auth storage interface
 */
export interface AuthStorage {
  /**
   * Get stored session data
   */
  getSession(): Promise<Result<SessionData>>;

  /**
   * Store session data
   */
  setSession(session: SessionData): Promise<Result<void>>;

  /**
   * Remove session data (logout)
   */
  clearSession(): Promise<Result<void>>;

  /**
   * Get access token only (for quick auth checks)
   */
  getToken(): Promise<Result<string>>;
}

/**
 * Profile storage for caching user data locally
 */
export interface ProfileStorage {
  loadProfile(): Promise<Result<AuthenticatedUser | null>>;
  saveProfile(user: AuthenticatedUser): Promise<Result<void>>;
  clearProfile(): Promise<Result<void>>;
}

/**
 * In-memory auth storage (for testing/fallback)
 */
export class MemoryAuthStorage implements AuthStorage {
  private session: SessionData | null = null;

  async getSession(): Promise<Result<SessionData>> {
    if (this.session) {
      return ok(this.session);
    }
    return err(new Error('No session found'));
  }

  async setSession(session: SessionData): Promise<Result<void>> {
    this.session = session;
    return ok(undefined);
  }

  async clearSession(): Promise<Result<void>> {
    this.session = null;
    return ok(undefined);
  }

  async getToken(): Promise<Result<string>> {
    if (this.session?.accessToken) {
      return ok(this.session.accessToken);
    }
    return err(new Error('No token found'));
  }
}

/**
 * Browser LocalStorage implementation
 */
export class LocalStorageAuthStorage implements AuthStorage {
  private readonly SESSION_KEY = '@taskforceai:session';
  private readonly TOKEN_KEY = '@taskforceai:token';
  private readonly LEGACY_TOKEN_KEY = 'authToken';
  private readonly sessionSchema = z
    .object({
      accessToken: z.string(),
      refreshToken: z.string().optional(),
      expiresAt: z.number().int(),
      user: z.object({
        id: z.union([z.number(), z.string().min(1)]),
        email: z.string(),
        plan: z.enum(['free', 'pro', 'super', 'admin']),
      }),
    })
    .strict();

  async getSession(): Promise<Result<SessionData>> {
    if (typeof window === 'undefined') return err(new Error('Window not defined'));

    try {
      const sessionJson = localStorage.getItem(this.SESSION_KEY);
      if (sessionJson) {
        const parsed = parseJsonSchema(sessionJson, this.sessionSchema);
        if (!parsed.ok) {
          logger.warn('Auth session in storage failed validation; clearing it', {
            error: parsed.error,
          });
          localStorage.removeItem(this.SESSION_KEY);
          return err(new Error('Session validation failed'));
        }
        return ok(parsed.value as SessionData);
      }

      return err(new Error('No session found'));
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async setSession(session: SessionData): Promise<Result<void>> {
    if (typeof window === 'undefined') return ok(undefined);

    try {
      localStorage.setItem(this.SESSION_KEY, JSON.stringify(session));
      localStorage.removeItem(this.TOKEN_KEY);
      localStorage.removeItem(this.LEGACY_TOKEN_KEY);
      return ok(undefined);
    } catch (error) {
      logger.error('Failed to save session', { error });
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async clearSession(): Promise<Result<void>> {
    if (typeof window === 'undefined') return ok(undefined);

    try {
      localStorage.removeItem(this.SESSION_KEY);
      localStorage.removeItem(this.TOKEN_KEY);
      localStorage.removeItem(this.LEGACY_TOKEN_KEY);
      return ok(undefined);
    } catch (error) {
      logger.error('Failed to clear session', { error });
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async getToken(): Promise<Result<string>> {
    const result = await this.getSession();
    if (result.ok) {
      return ok(result.value.accessToken);
    }
    return err(result.error);
  }
}
