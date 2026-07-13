import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, mock, vi } from 'bun:test';
import React from 'react';

import '../../../../../tests/setup/dom';

mock.restore();

// 1. Setup controllable mock state
let mockIsAuthenticated = true;
let mockSessionStatus = 'authenticated';
let mockIsTokenReady = true;
let mockSdkKey: string | undefined;
let mockUser: { id: string; email?: string; plan?: string } | null = null;
let mockAuthProviderInitialAuth: unknown = undefined;
let Providers: typeof import('./RootProviders').Providers;

(globalThis as any).__TASKFORCEAI_ROOT_PROVIDERS_TEST_STATE__ = {
  get isAuthenticated() {
    return mockIsAuthenticated;
  },
  get isTokenReady() {
    return mockIsTokenReady;
  },
  get sdkKey() {
    return mockSdkKey;
  },
  get user() {
    return mockUser;
  },
  onInitialAuth(initialAuth: unknown) {
    mockAuthProviderInitialAuth = initialAuth;
  },
};

mock.module('../providers/AuthProvider', () => ({
  AuthProvider: ({
    children,
    initialAuth,
  }: {
    children: React.ReactNode;
    initialAuth?: unknown;
  }) => (
    <div data-testid="auth-provider" data-has-initial-auth={initialAuth ? 'true' : 'false'}>
      {(() => {
        mockAuthProviderInitialAuth = initialAuth;
        return children;
      })()}
    </div>
  ),
  useAuth: () => ({
    user: mockUser,
    isAuthenticated: mockIsAuthenticated,
    sessionStatus: mockSessionStatus,
    isTokenReady: mockIsTokenReady,
  }),
}));

mock.module('@taskforceai/config/app-env', () => ({
  getRuntimeEnv: () => mockSdkKey,
}));

mock.module('@taskforceai/feature-flags', () => ({
  FeatureFlagProvider: ({
    children,
    options,
    sdkKey,
    user,
  }: {
    children: React.ReactNode;
    options?: {
      networkConfig?: {
        initializeUrl?: string;
        initializeFallbackUrls?: string[];
        logEventUrl?: string;
        logEventFallbackUrls?: string[];
        sdkExceptionUrl?: string;
      };
    };
    sdkKey: string;
    user: { userID: string; email: string; custom: { tier: string } };
  }) => (
    <div
      data-initialize-fallback-count={options?.networkConfig?.initializeFallbackUrls?.length}
      data-initialize-fallback-urls={options?.networkConfig?.initializeFallbackUrls?.join(',')}
      data-initialize-url={options?.networkConfig?.initializeUrl}
      data-log-event-fallback-count={options?.networkConfig?.logEventFallbackUrls?.length}
      data-log-event-fallback-urls={options?.networkConfig?.logEventFallbackUrls?.join(',')}
      data-log-event-url={options?.networkConfig?.logEventUrl}
      data-sdk-exception-url={options?.networkConfig?.sdkExceptionUrl}
      data-sdk-key={sdkKey}
      data-testid="feature-flag-provider"
      data-user-id={user.userID}
    >
      {children}
    </div>
  ),
}));

mock.module('../providers/SyncProvider', () => ({
  SyncProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="sync-provider">{children}</div>
  ),
}));

mock.module('../providers/StreamingProvider', () => ({
  StreamingProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="streaming-provider">{children}</div>
  ),
}));

mock.module('../hooks/usePrefetch', () => ({
  usePrefetch: vi.fn(),
}));

beforeAll(async () => {
  ({ Providers } = await import('./RootProviders'));
});

describe('RootProviders', () => {
  afterEach(() => {
    mockAuthProviderInitialAuth = undefined;
    cleanup();
  });

  it('wraps children with all providers when authenticated', () => {
    mockIsAuthenticated = true;
    mockSessionStatus = 'authenticated';
    mockIsTokenReady = true;
    mockSdkKey = undefined;
    mockUser = null;

    render(
      <Providers>
        <div data-testid="child">Content</div>
      </Providers>
    );

    expect(screen.getByTestId('auth-provider')).toBeDefined();
    expect(screen.getByTestId('streaming-provider')).toBeDefined();
    expect(screen.getByTestId('sync-provider')).toBeDefined();
    expect(screen.getByTestId('child')).toBeDefined();
  });

  it('passes initial auth into AuthProvider', () => {
    const initialAuth = {
      user: { id: 1, email: 'server@example.com' },
      isAuthenticated: true,
      sessionStatus: 'authenticated',
    };

    render(
      <Providers initialAuth={initialAuth as never}>
        <div data-testid="child">Content</div>
      </Providers>
    );

    expect(screen.getByTestId('auth-provider')).toHaveAttribute('data-has-initial-auth', 'true');
    expect(mockAuthProviderInitialAuth).toBe(initialAuth);
  });

  it('skips SyncProvider when unauthenticated', () => {
    mockIsAuthenticated = false;
    mockSessionStatus = 'unauthenticated';
    mockIsTokenReady = false;
    mockSdkKey = undefined;
    mockUser = null;

    render(
      <Providers>
        <div data-testid="child">Content</div>
      </Providers>
    );

    expect(screen.queryByTestId('sync-provider')).toBeNull();
    expect(screen.getByTestId('child')).toBeDefined();
  });

  it('skips SyncProvider until token is ready', () => {
    mockIsAuthenticated = true;
    mockSessionStatus = 'authenticated';
    mockIsTokenReady = false;
    mockSdkKey = undefined;
    mockUser = null;

    render(
      <Providers>
        <div data-testid="child">Content</div>
      </Providers>
    );

    expect(screen.queryByTestId('sync-provider')).toBeNull();
    expect(screen.getByTestId('child')).toBeDefined();
  });

  it('wraps authenticated users with feature flags when configured', () => {
    mockIsAuthenticated = true;
    mockSessionStatus = 'authenticated';
    mockIsTokenReady = true;
    mockSdkKey = 'client-key';
    mockUser = { id: 'user-123', email: 'clay@example.com', plan: 'super' };

    render(
      <Providers>
        <div data-testid="child">Content</div>
      </Providers>
    );

    const featureFlags = screen.getByTestId('feature-flag-provider');
    expect(featureFlags).toHaveAttribute('data-sdk-key', 'client-key');
    expect(featureFlags).toHaveAttribute('data-user-id', 'user-123');
    expect(featureFlags).toHaveAttribute(
      'data-initialize-url',
      'https://featureassets.org/v1/initialize'
    );
    expect(featureFlags).toHaveAttribute('data-initialize-fallback-count', '1');
    expect(featureFlags).toHaveAttribute(
      'data-initialize-fallback-urls',
      'https://assetsconfigcdn.org/v1/initialize'
    );
    expect(featureFlags).toHaveAttribute(
      'data-log-event-url',
      'https://prodregistryv2.org/v1/rgstr'
    );
    expect(featureFlags).toHaveAttribute('data-log-event-fallback-count', '1');
    expect(featureFlags).toHaveAttribute(
      'data-log-event-fallback-urls',
      'https://beyondwickedmapping.org/v1/rgstr'
    );
    expect(featureFlags).toHaveAttribute(
      'data-sdk-exception-url',
      'https://statsigapi.net/v1/sdk_exception'
    );
    expect(screen.getByTestId('sync-provider')).toBeDefined();
    expect(screen.getByTestId('child')).toBeDefined();
  });
});
