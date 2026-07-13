import { MemoryAuthStorage } from '@taskforceai/api-client/auth/storage';
import {
  AuthProvider as SharedAuthProvider,
  type InitialAuthSnapshot,
  useAuth,
} from '@taskforceai/react-core/auth/AuthProvider';
import { useEffect, useState } from 'react';
import type { ProfileStorage } from '@taskforceai/api-client/auth/storage';
import {
  loadStoredUser,
  storeUser,
  clearStoredUser,
} from '@taskforceai/api-client/auth/auth-storage';
import type { AuthenticatedUser } from '@taskforceai/contracts/contracts';
import { type Result, ok, err } from '@taskforceai/client-core/result';
import { getAuthLogger } from '@taskforceai/api-client/auth/logger';
import {
  getDesktopAppServerAuthStatus,
  getDesktopAppServerLocalSettings,
  logoutDesktopAppServerAuth,
} from '../platform/desktop/app-server';
import type {
  AppServerAuthStatus,
  AppServerLocalSettings,
} from '../platform/desktop/app-server-types';
import { usePlatformRuntime, useStorageAdapter } from '../platform/PlatformProvider';
import { DESKTOP_APP_SERVER_AUTH_CHANGED_EVENT } from '../platform/desktop/auth-events';
import { clearPinnedConversationIds } from '../storage/pinned-conversations';

const logger = getAuthLogger();

const clearLegacySessionArtifacts = () => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.removeItem('@taskforceai:session');
    window.localStorage.removeItem('@taskforceai:token');
    window.localStorage.removeItem('authToken');
  } catch (error) {
    logger.warn('Failed to clear legacy auth session artifacts', { error });
  }
};

clearLegacySessionArtifacts();

const webAuthStorage = new MemoryAuthStorage();

const desktopSetting = (
  settings: AppServerLocalSettings | null,
  key: keyof AppServerLocalSettings
): boolean => settings?.[key] !== false;

const createDesktopAuthenticatedUser = (
  status: AppServerAuthStatus | null,
  settings: AppServerLocalSettings | null
): AuthenticatedUser | null => {
  if (!status?.authenticated) {
    return null;
  }
  const numericId = Number(status.user?.id);
  return {
    id: Number.isFinite(numericId) ? numericId : 0,
    email: status.user?.email ?? 'desktop@taskforceai.local',
    full_name: status.user?.fullName ?? 'TaskForceAI Desktop',
    image: status.user?.image ?? null,
    plan: 'free',
    message_count: 0,
    free_tasks_remaining: 0,
    memory_enabled: desktopSetting(settings, 'memoryEnabled'),
    web_search_enabled: desktopSetting(settings, 'webSearchEnabled'),
    code_execution_enabled: desktopSetting(settings, 'codeExecutionEnabled'),
    mfa_enabled: false,
    trust_layer_enabled: desktopSetting(settings, 'trustLayerEnabled'),
    notifications_enabled: desktopSetting(settings, 'notificationsEnabled'),
    quick_mode_enabled: true,
    theme_preference: 'system',
    disabled: 'false',
    is_admin: false,
    cancel_at_period_end: false,
    current_period_end: null,
    current_period_start: null,
    customer_id: null,
    last_message_timestamp: null,
    subscription_id: null,
    subscription_source: null,
    subscription_status: null,
    trial_ends_at: null,
  };
};

const webProfileStorage: ProfileStorage = {
  async loadProfile(): Promise<Result<AuthenticatedUser | null>> {
    const result = loadStoredUser();
    if (result.ok) {
      return ok(result.value as AuthenticatedUser);
    }
    return ok(null);
  },
  async saveProfile(user: AuthenticatedUser): Promise<Result<void>> {
    try {
      storeUser(user);
      return ok(undefined);
    } catch (error) {
      logger.error('Failed to save profile', { error });
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  },
  async clearProfile(): Promise<Result<void>> {
    try {
      clearStoredUser();
      return ok(undefined);
    } catch (error) {
      logger.error('Failed to clear profile', { error });
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  },
};

export function AuthProvider({
  children,
  initialAuth = null,
}: {
  children: React.ReactNode;
  initialAuth?: InitialAuthSnapshot | null;
}) {
  const platformRuntime = usePlatformRuntime();
  const storageAdapter = useStorageAdapter();
  const [desktopAuthStatus, setDesktopAuthStatus] = useState<AppServerAuthStatus | null>(null);
  const [desktopLocalSettings, setDesktopLocalSettings] = useState<AppServerLocalSettings | null>(
    null
  );

  useEffect(() => {
    if (platformRuntime !== 'desktop') {
      setDesktopAuthStatus(null);
      setDesktopLocalSettings(null);
      return;
    }

    let active = true;
    let requestSequence = 0;
    const loadDesktopAuthStatus = async () => {
      const requestId = ++requestSequence;
      try {
        const [status, localSettings] = await Promise.all([
          getDesktopAppServerAuthStatus(),
          getDesktopAppServerLocalSettings(),
        ]);
        if (active && requestId === requestSequence) {
          setDesktopAuthStatus(status);
          setDesktopLocalSettings(localSettings.settings);
        }
      } catch (error) {
        logger.debug('Desktop auth status unavailable', { error });
        if (active && requestId === requestSequence) {
          setDesktopAuthStatus({ authenticated: false });
        }
      }
    };

    void loadDesktopAuthStatus();
    const handleDesktopAuthChanged = () => {
      void loadDesktopAuthStatus();
    };
    window.addEventListener(DESKTOP_APP_SERVER_AUTH_CHANGED_EVENT, handleDesktopAuthChanged);
    const timer = window.setInterval(() => {
      void loadDesktopAuthStatus();
    }, 5000);

    return () => {
      active = false;
      window.removeEventListener(DESKTOP_APP_SERVER_AUTH_CHANGED_EVENT, handleDesktopAuthChanged);
      window.clearInterval(timer);
    };
  }, [platformRuntime]);

  const desktopAuthenticated = desktopAuthStatus?.authenticated ?? null;
  const desktopUser = createDesktopAuthenticatedUser(desktopAuthStatus, desktopLocalSettings);

  return (
    <SharedAuthProvider
      config={{
        authStorage: webAuthStorage,
        profileStorage: webProfileStorage,
        allowProfileBootstrapWithoutSession: platformRuntime !== 'desktop',
        onLogout:
          platformRuntime === 'desktop'
            ? async () => {
                try {
                  const status = await logoutDesktopAppServerAuth();
                  setDesktopAuthStatus(status);
                } catch (error) {
                  logger.warn('Failed to logout desktop app-server auth', { error });
                  setDesktopAuthStatus({ authenticated: false });
                } finally {
                  clearPinnedConversationIds();
                }
              }
            : async () => {
                try {
                  await storageAdapter.clearAll();
                } catch (error) {
                  logger.warn('Failed to clear browser conversation storage on logout', { error });
                } finally {
                  clearPinnedConversationIds();
                }
              },
        initialAuth: platformRuntime === 'desktop' ? null : initialAuth,
        authOverride:
          platformRuntime === 'desktop'
            ? {
                user: desktopUser,
                isAuthenticated: desktopAuthenticated === true,
                isLoading: desktopAuthenticated === null,
                isTokenReady: desktopAuthenticated === true,
                sessionStatus:
                  desktopAuthenticated === null
                    ? 'loading'
                    : desktopAuthenticated
                      ? 'authenticated'
                      : 'unauthenticated',
              }
            : null,
      }}
    >
      {children}
    </SharedAuthProvider>
  );
}

export { useAuth };
