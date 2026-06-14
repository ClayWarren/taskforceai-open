'use client';

import type { AuthenticatedUser } from '@taskforceai/contracts/contracts';
import { logoutUser } from '@taskforceai/contracts/api/account';
import {
  AuthProvider as SharedAuthProvider,
  useAuth,
} from '@taskforceai/contracts/auth/AuthProvider';
import {
  clearStoredUser,
  loadStoredUser,
  storeUser,
} from '@taskforceai/contracts/auth/auth-storage';
import { getAuthLogger } from '@taskforceai/contracts/auth/logger';
import { LocalStorageAuthStorage, type ProfileStorage } from '@taskforceai/contracts/auth/storage';
import { type Result, err, ok } from '@taskforceai/shared/result';
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
    return result.ok ? ok(result.value as AuthenticatedUser) : ok(null);
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
