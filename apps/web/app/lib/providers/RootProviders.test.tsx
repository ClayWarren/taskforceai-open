import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, mock, vi } from 'bun:test';
import React from 'react';

import '../../../../../tests/setup/dom';

import { Providers } from './RootProviders';

// 1. Setup controllable mock state
let mockIsAuthenticated = true;
let mockSessionStatus = 'authenticated';
let mockIsTokenReady = true;
let mockSdkKey: string | undefined;
let mockUser: { id: string; email?: string; plan?: string } | null = null;

mock.module('../providers/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="auth-provider">{children}</div>
  ),
  useAuth: () => ({
    user: mockUser,
    isAuthenticated: mockIsAuthenticated,
    sessionStatus: mockSessionStatus,
    isTokenReady: mockIsTokenReady,
  }),
}));

mock.module('@taskforceai/shared/config/app-env', () => ({
  getRuntimeEnv: () => mockSdkKey,
}));

mock.module('@taskforceai/feature-flags', () => ({
  FeatureFlagProvider: ({
    children,
    sdkKey,
    user,
  }: {
    children: React.ReactNode;
    sdkKey: string;
    user: { userID: string; email: string; custom: { tier: string } };
  }) => (
    <div data-sdk-key={sdkKey} data-testid="feature-flag-provider" data-user-id={user.userID}>
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

describe('RootProviders', () => {
  afterEach(() => {
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
    expect(screen.getByTestId('sync-provider')).toBeDefined();
    expect(screen.getByTestId('child')).toBeDefined();
  });
});
