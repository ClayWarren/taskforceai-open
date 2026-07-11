'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuthenticatedUser } from '@taskforceai/contracts/contracts';
import React, {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { authClient } from '@taskforceai/api-client/auth/auth-client';
import { getAuthLogger } from '@taskforceai/api-client/auth/logger';
import { buildUserState, loadUserProfile } from '@taskforceai/api-client/auth/auth-service';
import { storeAuthToken, clearAuthToken } from '@taskforceai/api-client/auth/auth-storage';
import type { AuthStorage, ProfileStorage } from '@taskforceai/api-client/auth/storage';

export interface AuthProviderConfig {
  authStorage: AuthStorage;
  profileStorage: ProfileStorage;
  onLogout?: () => Promise<void> | void;
  onAuthError?: (error: Error) => void;
  gracePeriodMs?: number;
  initialAuth?: InitialAuthSnapshot | null;
  allowProfileBootstrapWithoutSession?: boolean;
  authOverride?: {
    user?: AuthenticatedUser | null;
    isAuthenticated: boolean;
    isLoading?: boolean;
    isTokenReady?: boolean;
    sessionStatus?: 'loading' | 'authenticated' | 'unauthenticated';
  } | null;
}

export interface InitialAuthSnapshot {
  user: AuthenticatedUser | null;
  isAuthenticated: boolean;
  sessionStatus?: 'loading' | 'authenticated' | 'unauthenticated';
}

export interface RefreshUserOptions {
  force?: boolean;
}

interface AuthContextType {
  user: AuthenticatedUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isTokenReady?: boolean;
  sessionStatus?: 'loading' | 'authenticated' | 'unauthenticated';
  logout: () => Promise<void>;
  refreshUser: (options?: RefreshUserOptions) => Promise<void>;
  handleAuthFailure?: (reason?: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const logger = getAuthLogger();
const firstAvailable = <T,>(...values: Array<T | null | undefined>): T | null =>
  values.find((value) => value !== null && value !== undefined) ?? null;

interface AuthProviderProps {
  config: AuthProviderConfig;
  children: ReactNode;
}

const useSession = (enabled: boolean) => {
  const { data: session, status: queryStatus } = useQuery({
    queryKey: ['session'],
    queryFn: () => authClient.getSession(),
    enabled,
    retry: false,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  const status: 'loading' | 'authenticated' | 'unauthenticated' = !enabled
    ? 'unauthenticated'
    : queryStatus === 'pending'
      ? 'loading'
      : session && session.user
        ? 'authenticated'
        : 'unauthenticated';

  return { data: session, status };
};

export const AuthProvider: React.FC<AuthProviderProps> = ({ config, children }) => {
  const {
    authStorage,
    profileStorage,
    onLogout,
    onAuthError,
    gracePeriodMs = 10000,
    initialAuth = null,
    allowProfileBootstrapWithoutSession = false,
  } = config;
  const authOverride = config.authOverride ?? null;
  const hasAuthOverride = authOverride !== null;
  const queryClient = useQueryClient();
  const initialAuthenticatedUserRef = useRef<AuthenticatedUser | null>(
    initialAuth?.isAuthenticated === true && initialAuth.user
      ? buildUserState(initialAuth.user)
      : null
  );
  const initialAuthenticatedUser = initialAuthenticatedUserRef.current;
  const { data: session, status } = useSession(!hasAuthOverride);

  const [localUser, setLocalUser] = useState<AuthenticatedUser | null>(initialAuthenticatedUser);
  const [hasBootstrapAuthenticatedSession, setHasBootstrapAuthenticatedSession] = useState(
    Boolean(initialAuthenticatedUser)
  );
  const [hasValidStoredToken, setHasValidStoredToken] = useState(false);
  const [bootstrapLoading, setBootstrapLoading] = useState(!initialAuthenticatedUser);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const localUserRef = useRef<AuthenticatedUser | null>(initialAuthenticatedUser);

  const authStartTimeRef = useRef<number | null>(null);
  const authFailureHandledRef = useRef(false);
  const isFetchingTokenRef = useRef(false);
  const lastFetchedTokenRef = useRef<string | null>(null);
  const lastValidatedUnauthenticatedTokenRef = useRef<string | null>(null);

  useEffect(() => {
    localUserRef.current = localUser;
  }, [localUser]);

  useEffect(() => {
    const initAuth = async () => {
      try {
        const [sessionResult, profileResult] = await Promise.all([
          authStorage.getSession(),
          profileStorage.loadProfile(),
        ]);
        if (sessionResult.ok && sessionResult.value) {
          if (authStartTimeRef.current === null) {
            authStartTimeRef.current = Date.now();
          }
          const token = sessionResult.value.accessToken;
          storeAuthToken(token);
          lastFetchedTokenRef.current = token;
          lastValidatedUnauthenticatedTokenRef.current = null;
          setHasValidStoredToken(true);
          if (profileResult.ok && profileResult.value) {
            setLocalUser(buildUserState(profileResult.value));
          }
        } else if (initialAuthenticatedUser) {
          setLocalUser((currentUser) => currentUser ?? initialAuthenticatedUser);
          setHasValidStoredToken(false);
          clearAuthToken();
          if (!profileResult.ok || !profileResult.value) {
            void profileStorage.saveProfile(initialAuthenticatedUser).then((result) => {
              if (!result.ok) {
                logger.error('Failed to save bootstrap profile during auth initialization', {
                  error: result.error,
                });
              }
            });
          }
        } else if (allowProfileBootstrapWithoutSession && profileResult.ok && profileResult.value) {
          setLocalUser(buildUserState(profileResult.value));
          setHasValidStoredToken(false);
          clearAuthToken();
        } else {
          setLocalUser(null);
          setHasValidStoredToken(false);
          clearAuthToken();
          await profileStorage.clearProfile();
        }
      } catch (error) {
        logger.warn('Failed to initialize auth', { error });
        setLocalUser(null);
        setHasValidStoredToken(false);
        clearAuthToken();
      } finally {
        setBootstrapLoading(false);
      }
    };

    void initAuth();
  }, [allowProfileBootstrapWithoutSession, authStorage, initialAuthenticatedUser, profileStorage]);

  useEffect(() => {
    if (hasAuthOverride || !hasBootstrapAuthenticatedSession || status === 'loading') {
      return;
    }
    setHasBootstrapAuthenticatedSession(false);
  }, [hasAuthOverride, hasBootstrapAuthenticatedSession, status]);

  const setUserState = useCallback(
    async (user: AuthenticatedUser | null) => {
      localUserRef.current = user;
      setLocalUser(user);
      if (user) {
        await profileStorage.saveProfile(user);
      } else {
        await profileStorage.clearProfile();
      }
    },
    [profileStorage]
  );

  useEffect(() => {
    const shouldFetchToken = status === 'authenticated' || hasBootstrapAuthenticatedSession;
    if (hasAuthOverride) {
      return;
    }

    if (shouldFetchToken && !hasValidStoredToken && !isSigningOut && !isFetchingTokenRef.current) {
      if (authStartTimeRef.current === null) {
        authStartTimeRef.current = Date.now();
      }

      isFetchingTokenRef.current = true;
      void authClient
        .getToken()
        .then((token) => {
          if (token) {
            storeAuthToken(token);
            lastFetchedTokenRef.current = token;
            lastValidatedUnauthenticatedTokenRef.current = null;
            setHasValidStoredToken(true);
          } else {
            logger.warn('Failed to retrieve token for authenticated session');
            if (onAuthError) {
              onAuthError(new Error('token_fetch_failed'));
            }
          }
        })
        .catch((error) => {
          logger.error('Error fetching token for authenticated session', { error });
          if (onAuthError) {
            onAuthError(error instanceof Error ? error : new Error('token_fetch_failed'));
          }
        })
        .finally(() => {
          isFetchingTokenRef.current = false;
        });
    } else if (
      status === 'unauthenticated' &&
      !hasBootstrapAuthenticatedSession &&
      lastFetchedTokenRef.current === null &&
      !isSigningOut
    ) {
      if (bootstrapLoading) {
        return;
      }
      // On mobile/proxy-based auth, status can be 'unauthenticated' if the proxy session endpoint
      // doesn't support the token yet or expects cookies. We should trust our local token/profile if it exists.
      if (!hasValidStoredToken) {
        if (localUser) {
          logger.warn('Clearing cached user because no valid stored token is available');
          void setUserState(null);
        }
        clearAuthToken();
        lastFetchedTokenRef.current = null;
        lastValidatedUnauthenticatedTokenRef.current = null;
        setHasValidStoredToken(false);
        authStartTimeRef.current = null;
      } else {
        logger.debug('Ignoring unauthenticated status because local user/token exists');
      }
    }
  }, [
    hasAuthOverride,
    hasBootstrapAuthenticatedSession,
    status,
    isSigningOut,
    onAuthError,
    hasValidStoredToken,
    localUser,
    bootstrapLoading,
    setUserState,
  ]);

  useEffect(() => {
    if (hasAuthOverride) {
      return;
    }

    if (status === 'authenticated' && session?.user && !isSigningOut) {
      const email = firstAvailable(session.user?.email, localUser?.email) ?? '';
      const fullName = firstAvailable(session.user?.name, localUser?.full_name);

      if (!localUser || localUser.email !== email || localUser.full_name !== fullName) {
        const merged = buildUserState({
          email,
          full_name: fullName,
          image: firstAvailable(session.user?.image, localUser?.image),
        });

        setLocalUser(merged);

        void profileStorage.saveProfile(merged).then((result) => {
          if (!result.ok) {
            logger.error('Failed to save profile during session sync', {
              error: result.error,
            });
          }
        });
      }
    }
  }, [hasAuthOverride, session, status, profileStorage, isSigningOut, localUser]);

  useEffect(() => {
    if (hasAuthOverride) {
      return;
    }

    const validateToken = async () => {
      // Avoid running during Web SSR. Mobile doesn't have SSR.
      const isBrowser = typeof window !== 'undefined';
      const isMobile = typeof navigator !== 'undefined' && navigator.product === 'ReactNative';
      if (!isBrowser && !isMobile) return;

      const hasStoredUser = Boolean(localUser);

      if ((hasStoredUser || hasValidStoredToken) && status === 'unauthenticated' && !isSigningOut) {
        const tokenKey = lastFetchedTokenRef.current;
        if (tokenKey && lastValidatedUnauthenticatedTokenRef.current === tokenKey) {
          return;
        }

        logger.debug('Validating session via profile load', { hasStoredUser, hasValidStoredToken });
        const result = await loadUserProfile();
        if (result.ok) {
          if (tokenKey) {
            lastValidatedUnauthenticatedTokenRef.current = tokenKey;
          }
          const formattedUser = result.value;
          await setUserState(formattedUser);
          setHasValidStoredToken(true);
        } else if (result.error.kind === 'unauthorized' || result.error.kind === 'not_found') {
          logger.warn('Token validation failed with permanent error, clearing auth state', {
            error: result.error,
          });
          await profileStorage.clearProfile();
          await setUserState(null);
          setHasValidStoredToken(false);
          clearAuthToken();
          lastFetchedTokenRef.current = null;
          lastValidatedUnauthenticatedTokenRef.current = null;
          authStartTimeRef.current = null;
        } else {
          if (tokenKey) {
            lastValidatedUnauthenticatedTokenRef.current = tokenKey;
          }
          logger.debug('Token validation failed with transient error, retaining state', {
            error: result.error,
          });
        }
      }
    };

    if (status !== 'loading' && !isSigningOut) {
      void validateToken();
    }
  }, [
    hasAuthOverride,
    localUser,
    setUserState,
    status,
    isSigningOut,
    profileStorage,
    hasValidStoredToken,
  ]);

  const handleAuthFailure = useCallback(
    async (reason?: string): Promise<void> => {
      if (authFailureHandledRef.current) {
        return;
      }

      const isPermanentFailure =
        reason === 'user_logout' ||
        reason === 'profile_not_found' ||
        reason === 'profile_unauthorized' ||
        reason === 'sync_unauthorized_error';

      if (!isPermanentFailure && authStartTimeRef.current !== null) {
        const elapsed = Date.now() - authStartTimeRef.current;
        if (elapsed < gracePeriodMs) {
          logger.info('Auth failure ignored during grace period', { reason, elapsed });
          return;
        }
      }

      authFailureHandledRef.current = true;
      setIsSigningOut(true);

      logger.warn('Auth session invalidated, forcing logout', { reason });

      if (onLogout) {
        try {
          await onLogout();
        } catch (error) {
          logger.error('Logout side effect failed', { error });
        }
      }

      try {
        await authStorage.clearSession();
        await profileStorage.clearProfile();
      } catch (error) {
        logger.error('Failed to clear storage', { error });
      }

      clearAuthToken();
      lastFetchedTokenRef.current = null;
      lastValidatedUnauthenticatedTokenRef.current = null;
      localUserRef.current = null;
      setLocalUser(null);
      setHasValidStoredToken(false);
      authStartTimeRef.current = null;

      try {
        await authClient.signOut({ redirect: false });
        await queryClient.invalidateQueries({ queryKey: ['session'] });
      } catch (error) {
        logger.error('Forced sign-out failed', { error });
      }

      // Break loop for permanent failures by redirecting to logout endpoint
      if (typeof window !== 'undefined' && isPermanentFailure && status === 'authenticated') {
        const origin = window.location.origin;
        window.location.href = `/auth/logout?callbackUrl=${encodeURIComponent(origin)}`;
        return;
      }

      if (onAuthError) {
        onAuthError(new Error(reason || 'Auth session invalidated'));
      }

      authFailureHandledRef.current = false;
      setIsSigningOut(false);
    },
    [queryClient, authStorage, profileStorage, gracePeriodMs, onAuthError, onLogout, status]
  );

  const hasLoadedProfileRef = useRef<string | null>(null);

  useEffect(() => {
    if (hasAuthOverride) {
      return;
    }

    if (status === 'authenticated' && hasValidStoredToken && session?.user && !isSigningOut) {
      // Avoid redundant profile loads for the same token
      if (hasLoadedProfileRef.current === lastFetchedTokenRef.current) {
        return;
      }

      const controller = new AbortController();
      const fetchUserProfile = async () => {
        const result = await loadUserProfile({ signal: controller.signal });

        if (controller.signal.aborted) {
          return;
        }

        if (result.ok) {
          hasLoadedProfileRef.current = lastFetchedTokenRef.current;
          const formattedUser = result.value;
          await setUserState(formattedUser);
          return;
        }

        if (result.error.kind === 'unauthorized' || result.error.kind === 'not_found') {
          logger.warn(`User profile fetch returned ${result.error.status}, forcing logout`, {
            kind: result.error.kind,
          });
          void handleAuthFailure(`profile_${result.error.kind}`);
          return;
        }

        logger.debug('OAuth user profile unavailable during transient fetch', {
          error: result.error,
        });
        const cachedUser = localUserRef.current;
        if (cachedUser) {
          return;
        }
        /* coverage-ignore-start -- fallback for transient profile fetch failures is exercised through integration auth flows; fake-timer unit coverage is brittle here. */
        await setUserState(
          buildUserState({
            email: session.user?.email || '',
            full_name: session.user?.name || null,
          })
        );
        /* coverage-ignore-end */
      };

      void fetchUserProfile();

      return () => {
        controller.abort();
      };
    }
    return undefined;
  }, [
    hasAuthOverride,
    session,
    setUserState,
    status,
    hasValidStoredToken,
    isSigningOut,
    handleAuthFailure,
  ]);

  const logout = useCallback(async (): Promise<void> => {
    setIsSigningOut(true);

    try {
      await authClient.signOut({ redirect: false });
    } catch (error) {
      logger.error('Logout request failed', { error });
    }

    if (onLogout) {
      try {
        await onLogout();
      } catch (error) {
        logger.error('Logout side effect failed', { error });
      }
    }

    try {
      await authStorage.clearSession();
      await profileStorage.clearProfile();
    } catch (error) {
      logger.error('Failed to clear storage', { error });
    }

    clearAuthToken();
    lastFetchedTokenRef.current = null;
    lastValidatedUnauthenticatedTokenRef.current = null;
    authStartTimeRef.current = null;
    setLocalUser(null);
    setHasValidStoredToken(false);
    try {
      await queryClient.invalidateQueries({ queryKey: ['session'] });
    } finally {
      setIsSigningOut(false);
    }
  }, [queryClient, authStorage, profileStorage, onLogout]);

  const refreshUser = useCallback(
    async (options: RefreshUserOptions = {}): Promise<void> => {
      logger.debug('Refreshing user state', { options });
      if (options.force) {
        const [sessionResult, profileResult] = await Promise.all([
          authStorage.getSession(),
          profileStorage.loadProfile(),
        ]);

        if (sessionResult.ok && sessionResult.value) {
          setHasValidStoredToken(true);
          storeAuthToken(sessionResult.value.accessToken);
          if (lastFetchedTokenRef.current !== sessionResult.value.accessToken) {
            lastFetchedTokenRef.current = sessionResult.value.accessToken;
            lastValidatedUnauthenticatedTokenRef.current = null;
          }
        }

        if (profileResult.ok && profileResult.value) {
          setLocalUser(buildUserState(profileResult.value));
        }
      }
      await queryClient.invalidateQueries({ queryKey: ['session'] });
      await queryClient.invalidateQueries({ queryKey: ['currentUser'] });
    },
    [queryClient, authStorage, profileStorage]
  );

  const effectiveSessionStatus =
    hasBootstrapAuthenticatedSession && status === 'loading' ? 'authenticated' : status;
  const isLoading = bootstrapLoading || (status === 'loading' && !hasBootstrapAuthenticatedSession);

  const contextValue = useMemo(() => {
    const baseValue = {
      user: localUser,
      isAuthenticated:
        Boolean(localUser || session?.user || hasValidStoredToken) &&
        (effectiveSessionStatus === 'authenticated' ||
          hasValidStoredToken ||
          hasBootstrapAuthenticatedSession),
      isLoading,
      isTokenReady: hasValidStoredToken,
      sessionStatus: effectiveSessionStatus,
      logout,
      refreshUser,
      handleAuthFailure,
    };

    if (!authOverride) {
      return baseValue;
    }

    const overrideStatus =
      authOverride.sessionStatus ??
      (authOverride.isLoading
        ? 'loading'
        : authOverride.isAuthenticated
          ? 'authenticated'
          : 'unauthenticated');

    return {
      ...baseValue,
      user: authOverride.user ?? baseValue.user,
      isAuthenticated: authOverride.isAuthenticated,
      isLoading: authOverride.isLoading ?? baseValue.isLoading,
      isTokenReady: authOverride.isTokenReady ?? authOverride.isAuthenticated,
      sessionStatus: overrideStatus,
    };
  }, [
    localUser,
    session?.user,
    logout,
    refreshUser,
    isLoading,
    effectiveSessionStatus,
    hasValidStoredToken,
    hasBootstrapAuthenticatedSession,
    handleAuthFailure,
    authOverride,
  ]);

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
