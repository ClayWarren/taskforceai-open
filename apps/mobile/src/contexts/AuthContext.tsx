/**
 * Auth Context - Mobile implementation
 *
 * Wraps the shared AuthProvider with mobile-specific storage (SQLite)
 * and mobile-specific callbacks (push notifications, etc.)
 */
import React, { ReactNode, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { AuthProvider as SharedAuthProvider } from '@taskforceai/react-core/auth/AuthProvider';
import { useAuth as useSharedAuth } from '@taskforceai/react-core/auth/AuthProvider';
import { sqliteStorage } from '../storage/sqlite-adapter';
import { canUseE2EAuthSeed, seedE2EAuthSession } from '../auth/e2e-session-seed';
import { useAuthSideEffects } from '../hooks/useAuthSideEffects';
import { mobileLogger } from '../logger';
import { unregisterPushNotifications } from '../notifications/registration';
import { queryClient } from '../providers/queryClient';
import {
  ACTIVE_CONVERSATION_KEY,
  GUEST_ACTIVE_CONVERSATION_KEY,
} from '../hooks/useConversationState';
import { clearAllDesktopPairingSessions } from '../features/desktop-work/pairing/session-store';
import { clearAuthToken } from '../auth/token-store';

interface AuthContextType {
  user: ReturnType<typeof useSharedAuth>['user'];
  isAuthenticated: ReturnType<typeof useSharedAuth>['isAuthenticated'];
  isLoading: ReturnType<typeof useSharedAuth>['isLoading'];
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const shouldSeedE2EAuthSession = (): boolean => {
  return canUseE2EAuthSeed();
};

const clearMobileUserLocalState = async (): Promise<void> => {
  queryClient.clear();

  await Promise.allSettled([
    AsyncStorage.removeItem(ACTIVE_CONVERSATION_KEY),
    AsyncStorage.removeItem(GUEST_ACTIVE_CONVERSATION_KEY),
    clearAllDesktopPairingSessions(),
    clearAuthToken(),
    sqliteStorage.clearSession(),
    sqliteStorage.clearAll(),
  ]).then((results) => {
    for (const result of results) {
      if (result.status === 'rejected') {
        mobileLogger.error('[AuthContext] Failed to clear mobile user-local state', {
          error: result.reason,
        });
      }
    }
  });
};

const getMobileSession = async () => {
  const result = await sqliteStorage.getSession();
  if (!result.ok && /expired/i.test(result.error.message)) {
    await clearMobileUserLocalState();
  }
  return result;
};

const mobileProfileStorage = {
  loadProfile: () => sqliteStorage.loadProfile(),
  saveProfile: (user: Parameters<typeof sqliteStorage.saveProfile>[0]) =>
    sqliteStorage.saveProfile(user),
  clearProfile: async () => {
    await clearMobileUserLocalState();
    await sqliteStorage.clearProfile();
    return { ok: true as const, value: undefined };
  },
};

function MobileAuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(() => !shouldSeedE2EAuthSession());

  useEffect(() => {
    if (ready) return;

    let cancelled = false;
    seedE2EAuthSession()
      .catch((error) => {
        mobileLogger.error('[E2EAuthSeed] Failed to seed simulator auth session', { error });
      })
      .finally(() => {
        if (!cancelled) {
          setReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [ready]);

  if (!ready) {
    return null;
  }

  return (
    <SharedAuthProvider
      config={{
        authStorage: {
          getSession: getMobileSession,
          setSession: (session) => sqliteStorage.setSession(session),
          clearSession: () => sqliteStorage.clearSession(),
          getToken: () => sqliteStorage.getToken(),
        },
        profileStorage: mobileProfileStorage,
        onLogout: async () => {
          await unregisterPushNotifications();
          await clearMobileUserLocalState();
        },
      }}
    >
      {children}
    </SharedAuthProvider>
  );
}

function AuthConsumer({ children }: { children: (auth: AuthContextType) => ReactNode }) {
  const auth = useSharedAuth();
  const { user } = auth;

  useAuthSideEffects(user);

  return <>{children(auth)}</>;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <MobileAuthProvider>
      <AuthConsumer>{() => children}</AuthConsumer>
    </MobileAuthProvider>
  );
}

export const useAuth = useSharedAuth;
