'use client';

import { authenticatedUserSchema, type AuthenticatedUser } from '@taskforceai/contracts/contracts';
import { logoutUser } from '@taskforceai/api-client/api/account';
import {
  AuthProvider as SharedAuthProvider,
  useAuth,
} from '@taskforceai/react-core/auth/AuthProvider';
import {
  clearStoredUser,
  loadStoredUser,
  storeUser,
} from '@taskforceai/api-client/auth/auth-storage';
import { getAuthLogger } from '@taskforceai/api-client/auth/logger';
import { LocalStorageAuthStorage, type ProfileStorage } from '@taskforceai/api-client/auth/storage';
import { type Result, err, ok } from '@taskforceai/client-core/result';
import type { ReactNode } from 'react';

const logger = getAuthLogger();
const browserAuthStorage = new LocalStorageAuthStorage();

const toProfileStorageError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error;
  }
  return new Error(typeof error === 'string' ? error : JSON.stringify(error));
};

const browserProfileStorage: ProfileStorage = {
  async loadProfile(): Promise<Result<AuthenticatedUser | null>> {
    const result = loadStoredUser();
    if (!result.ok) {
      return ok(null);
    }
    const parsedUser = authenticatedUserSchema.safeParse(result.value);
    if (!parsedUser.success) {
      logger.warn('Ignoring incomplete stored user profile', { error: parsedUser.error });
      return ok(null);
    }
    return ok(parsedUser.data);
  },
  async saveProfile(user: AuthenticatedUser): Promise<Result<void>> {
    const result = storeUser(user);
    if (result.ok) return ok(undefined);
    logger.error('Failed to store user profile', { error: result.error });
    return err(toProfileStorageError(result.error));
  },
  async clearProfile(): Promise<Result<void>> {
    try {
      clearStoredUser();
      return ok(undefined);
    } catch (error) {
      logger.error('Failed to clear user profile', { error });
      return err(toProfileStorageError(error));
    }
  },
};

export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <SharedAuthProvider
      config={{
        authStorage: browserAuthStorage,
        profileStorage: browserProfileStorage,
        onLogout: async () => {
          await logoutUser();
        },
      }}
    >
      {children}
    </SharedAuthProvider>
  );
}

export { useAuth };
