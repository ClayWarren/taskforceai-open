'use client';

import { FeatureFlagProvider } from '@taskforceai/feature-flags';
import { getRuntimeEnv } from '@taskforceai/shared/config/app-env';
import { QueryProvider } from '@taskforceai/ui-kit/QueryProvider';
import React from 'react';
import { I18nextProvider } from 'react-i18next';
import type { InitialAuthSnapshot } from '@taskforceai/contracts/auth/AuthProvider';

import i18n from '../i18n';
import { PlatformProvider } from '../platform/PlatformProvider';
import { AuthProvider, useAuth } from './AuthProvider';
import { StreamingProvider } from './StreamingProvider';
import { SyncProvider } from './SyncProvider';

export function Providers({
  children,
  initialAuth = null,
}: {
  children: React.ReactNode;
  initialAuth?: InitialAuthSnapshot | null;
}) {
  return (
    <QueryProvider queryDefaults={{ staleTime: 60 * 1000 }}>
      <PlatformProvider>
        <I18nextProvider i18n={i18n}>
          <AuthProvider initialAuth={initialAuth}>
            <SyncGate>
              <FeatureFlagGate>
                <StreamingProvider>{children}</StreamingProvider>
              </FeatureFlagGate>
            </SyncGate>
          </AuthProvider>
        </I18nextProvider>
      </PlatformProvider>
    </QueryProvider>
  );
}

/**
 * Mounts FeatureFlagProvider only when authenticated to enable user-targeted flags.
 */
function FeatureFlagGate({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated } = useAuth();
  const sdkKey = getRuntimeEnv('VITE_STATSIG_CLIENT_KEY');

  const statsigUser = React.useMemo(() => {
    if (!user) return null;
    return {
      userID: String(user.id),
      email: user.email || '',
      custom: {
        tier: user.plan || 'free',
      },
    };
  }, [user?.id, user?.email, user?.plan]);

  if (!isAuthenticated || !statsigUser || !sdkKey) {
    return <>{children}</>;
  }

  return (
    <FeatureFlagProvider sdkKey={sdkKey} user={statsigUser}>
      {children}
    </FeatureFlagProvider>
  );
}

/**
 * Mounts SyncProvider only when the user is authenticated to avoid unauthenticated clients
 * hammering the sync APIs.
 */
function SyncGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isTokenReady } = useAuth();
  const shouldEnableSync = isAuthenticated && isTokenReady;

  if (!shouldEnableSync) {
    return <>{children}</>;
  }

  return <SyncProvider>{children}</SyncProvider>;
}
