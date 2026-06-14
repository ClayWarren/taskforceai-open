import { MemoryAuthStorage } from '@taskforceai/contracts/auth/storage';
import {
  AuthProvider as SharedAuthProvider,
  useAuth,
} from '@taskforceai/contracts/auth/AuthProvider';
import { useEffect, useState } from 'react';
import type { ProfileStorage } from '@taskforceai/contracts/auth/storage';
import {
  loadStoredUser,
  storeUser,
  clearStoredUser,
} from '@taskforceai/contracts/auth/auth-storage';
import type { AuthenticatedUser } from '@taskforceai/contracts/contracts';
import { type Result, ok, err } from '@taskforceai/shared/result';
import { getAuthLogger } from '@taskforceai/contracts/auth/logger';
import {
  getDesktopAppServerAuthStatus,
  getDesktopAppServerLocalSettings,
  logoutDesktopAppServerAuth,
} from '../platform/desktop/app-server';
import type {
  AppServerAuthStatus,
  AppServerLocalSettings,
} from '../platform/desktop/app-server-types';
import { usePlatformRuntime } from '../platform/PlatformProvider';

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
    memory_enabled: settings?.memoryEnabled ?? true,
    web_search_enabled: settings?.webSearchEnabled ?? true,
    code_execution_enabled: settings?.codeExecutionEnabled ?? true,
    trust_layer_enabled: settings?.trustLayerEnabled ?? true,
    notifications_enabled: settings?.notificationsEnabled ?? true,
    quick_mode_enabled: true,
    theme_preference: 'system',
    disabled: 'false',
    is_admin: 'false',
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const platformRuntime = usePlatformRuntime();
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
    const loadDesktopAuthStatus = async () => {
      try {
        const [status, localSettings] = await Promise.all([
          getDesktopAppServerAuthStatus(),
          getDesktopAppServerLocalSettings(),
        ]);
        if (active) {
          setDesktopAuthStatus(status);
          setDesktopLocalSettings(localSettings.settings);
        }
      } catch (error) {
        logger.debug('Desktop auth status unavailable', { error });
        if (active) {
          setDesktopAuthStatus({ authenticated: false });
        }
      }
    };

    void loadDesktopAuthStatus();
    const timer = window.setInterval(() => {
      void loadDesktopAuthStatus();
    }, 5000);

    return () => {
      active = false;
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
        onLogout:
          platformRuntime === 'desktop'
            ? async () => {
                try {
                  const status = await logoutDesktopAppServerAuth();
                  setDesktopAuthStatus(status);
                } catch (error) {
                  logger.warn('Failed to logout desktop app-server auth', { error });
                  setDesktopAuthStatus({ authenticated: false });
                }
              }
            : undefined,
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
