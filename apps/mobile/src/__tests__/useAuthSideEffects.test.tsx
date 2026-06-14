import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import type { AuthenticatedUser } from '@taskforceai/contracts/contracts';

jest.mock('../billing/revenuecat', () => ({
  configureRevenueCat: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
}));

import { configureRevenueCat } from '../billing/revenuecat';
import { resolveRevenueCatAppUserId, useAuthSideEffects } from '../hooks/useAuthSideEffects';

const configureRevenueCatMock = configureRevenueCat as jest.MockedFunction<typeof configureRevenueCat>;

const renderHook = (user: AuthenticatedUser | null) => {
  let hookValue: ReturnType<typeof useAuthSideEffects> | null = null;
  let renderer: TestRenderer.ReactTestRenderer | null = null;

  const Wrapper: React.FC = () => {
    hookValue = useAuthSideEffects(user);
    return null;
  };

  act(() => {
    renderer = TestRenderer.create(<Wrapper />);
  });

  const cleanup = () => {
    act(() => {
      if (renderer) {
        renderer.unmount();
      }
    });
  };

  return { hook: hookValue, cleanup };
};

describe('useAuthSideEffects', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('configures RevenueCat with the backend subscription sync app user id', async () => {
    const user: AuthenticatedUser = {
      id: 'user-1',
      email: 'Test@Example.com',
      plan: 'free',
    } as any;

    const { cleanup } = renderHook(user);

    expect(configureRevenueCatMock).toHaveBeenCalledWith('test@example.com');
    cleanup();
  });

  it('falls back to the stable user id when email is unavailable', () => {
    const user: AuthenticatedUser = {
      id: 'user-1',
      email: '',
      plan: 'free',
    } as any;

    const { cleanup } = renderHook(user);

    expect(configureRevenueCatMock).toHaveBeenCalledWith('user-1');
    cleanup();
  });

  it('logs RevenueCat out when user is null', () => {
    const { cleanup } = renderHook(null);

    expect(configureRevenueCatMock).toHaveBeenCalledWith(null);
    cleanup();
  });

  it('logs RevenueCat out when user id is undefined', () => {
    const user = { email: 'test@example.com', plan: 'free' } as any;

    const { cleanup } = renderHook(user);

    expect(configureRevenueCatMock).toHaveBeenCalledWith('test@example.com');
    cleanup();
  });

  it('logs RevenueCat out when user identifiers are blocked placeholders', () => {
    const user = { id: 0, email: '', plan: 'free' } as any;

    const { cleanup } = renderHook(user);

    expect(configureRevenueCatMock).toHaveBeenCalledWith(null);
    cleanup();
  });

  it('does not send identifiers blocked by RevenueCat', () => {
    expect(resolveRevenueCatAppUserId({ id: 0, email: '' })).toBeNull();
    expect(resolveRevenueCatAppUserId({ id: 'user/1', email: '' })).toBeNull();
    expect(resolveRevenueCatAppUserId({ id: 'undefined', email: '' })).toBeNull();
    expect(resolveRevenueCatAppUserId({ id: 123, email: 'buyer@example.com' })).toBe(
      'buyer@example.com'
    );
  });

  it('re-configures RevenueCat when user id changes', () => {
    const user1: AuthenticatedUser = {
      id: 'user-1',
      email: 'test1@example.com',
      plan: 'free',
    } as any;

    const user2: AuthenticatedUser = {
      id: 'user-2',
      email: 'test2@example.com',
      plan: 'free',
    } as any;

    const { cleanup } = renderHook(user1);
    expect(configureRevenueCatMock).toHaveBeenCalledWith('test1@example.com');

    configureRevenueCatMock.mockClear();
    const { cleanup: cleanup2 } = renderHook(user2);
    expect(configureRevenueCatMock).toHaveBeenCalledWith('test2@example.com');
    
    cleanup();
    cleanup2();
  });
});
