import type { ApiClient } from '../client';

import { type Result, err, ok } from '@taskforceai/client-core/result';
import { getAuthLogger } from './logger';
import type { AuthStorage } from './storage';
import type { AuthenticatedUser, SessionData } from './types';
import { isTokenExpired } from './utils';

export type AuthApiClient = Pick<ApiClient, 'logout' | 'currentUser'>;

export interface AuthClientConfig {
  apiClient: AuthApiClient;
  storage: AuthStorage;
}

export class AuthClient {
  private logger = getAuthLogger();
  constructor(private c: AuthClientConfig) {}

  async logout(): Promise<Result<void>> {
    try {
      await this.c.apiClient.logout();
    } catch (e) {
      this.logger.warn('Logout failed at server', { e });
    }
    const clearResult = await this.c.storage.clearSession();
    if (!clearResult.ok) {
      this.logger.error('Failed to clear local session during logout', {
        error: clearResult.error,
      });
      return err(clearResult.error);
    }
    return ok(undefined);
  }

  async getSession(): Promise<Result<SessionData>> {
    const r = await this.c.storage.getSession();
    if (!r.ok) return r;
    if (isTokenExpired(r.value.expiresAt)) {
      await this.c.storage.clearSession();
      return err(new Error('Session expired'));
    }
    return r;
  }

  async getCurrentUser(): Promise<Result<AuthenticatedUser>> {
    try {
      const u = await this.c.apiClient.currentUser();
      return ok(u);
    } catch (e: any) {
      if (e?.status === 401) await this.c.storage.clearSession();
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async isAuthenticated(): Promise<boolean> {
    return (await this.getSession()).ok;
  }
  async getToken(): Promise<Result<string>> {
    const r = await this.getSession();
    return r.ok ? ok(r.value.accessToken) : err(r.error);
  }
}

export const createAuthClient = (c: AuthClientConfig) => new AuthClient(c);
