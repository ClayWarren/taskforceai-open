import { cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, mock } from 'bun:test';
import React from 'react';
import '../../../../../tests/setup/dom';
import { FeatureFlagProvider, useFeatureFlag, FEATURE_FLAGS } from './index';
import { StatsigContext } from '@statsig/react-bindings';
import { StatsigClient } from '@statsig/js-client';

function buildWrapper(
  gateValue: boolean | undefined,
  options?: { isLoading?: boolean; reason?: string; legacyOnly?: boolean }
) {
  const client = options?.legacyOnly
    ? {
        checkGate: mock(() => gateValue),
      }
    : {
        checkGate: mock(() => gateValue),
        getFeatureGate: mock(() => ({
          value: gateValue,
          details: {
            reason: options?.reason ?? 'Network:Recognized',
          },
        })),
      };
  const contextValue = {
    renderVersion: 1,
    isLoading: options?.isLoading ?? false,
    client,
  };

  return ({ children }: { children: React.ReactNode }) => (
    <StatsigContext.Provider value={contextValue as any}>{children}</StatsigContext.Provider>
  );
}

describe('useFeatureFlag', () => {
  afterEach(() => {
    cleanup();
  });

  it('returns true when gate is enabled', () => {
    const { result } = renderHook(() => useFeatureFlag(FEATURE_FLAGS.MODE_COMPUTER_USE), {
      wrapper: buildWrapper(true),
    });
    expect(result.current).toBe(true);
  });

  it('returns false when gate is disabled', () => {
    const { result } = renderHook(() => useFeatureFlag(FEATURE_FLAGS.MODE_COMPUTER_USE), {
      wrapper: buildWrapper(false),
    });
    expect(result.current).toBe(false);
  });

  it('honors recognized false values for default-true gates', () => {
    const { result } = renderHook(() => useFeatureFlag(FEATURE_FLAGS.MODE_QUICK), {
      wrapper: buildWrapper(false, { reason: 'Network:Recognized' }),
    });
    expect(result.current).toBe(false);
  });

  it('falls back to default value when gate value is undefined', () => {
    // Quick mode defaults to true
    const { result } = renderHook(() => useFeatureFlag(FEATURE_FLAGS.MODE_QUICK), {
      wrapper: buildWrapper(undefined),
    });
    expect(result.current).toBe(true);

    // Computer use defaults to false
    const { result: result2 } = renderHook(() => useFeatureFlag(FEATURE_FLAGS.MODE_COMPUTER_USE), {
      wrapper: buildWrapper(undefined),
    });
    expect(result2.current).toBe(false);
  });

  it('falls back to defaults when Statsig has no cached values yet', () => {
    const { result } = renderHook(() => useFeatureFlag(FEATURE_FLAGS.MODE_QUICK), {
      wrapper: buildWrapper(false, { reason: 'NoValues' }),
    });
    expect(result.current).toBe(true);
  });

  it('falls back to defaults when Statsig reports an unrecognized gate', () => {
    const { result } = renderHook(() => useFeatureFlag(FEATURE_FLAGS.ENABLE_PAYMENTS), {
      wrapper: buildWrapper(false, { reason: 'Cache:Unrecognized' }),
    });
    expect(result.current).toBe(true);
  });

  it('falls back to defaults when no provider is mounted', () => {
    const { result } = renderHook(() => useFeatureFlag(FEATURE_FLAGS.MODE_COMPUTER_USE));
    expect(result.current).toBe(false);

    const { result: quickModeResult } = renderHook(() => useFeatureFlag(FEATURE_FLAGS.MODE_QUICK));
    expect(quickModeResult.current).toBe(true);
  });

  it('falls back to defaults while Statsig is still loading', () => {
    const { result } = renderHook(() => useFeatureFlag(FEATURE_FLAGS.MODE_COMPUTER_USE), {
      wrapper: buildWrapper(true, { isLoading: true }),
    });
    expect(result.current).toBe(false);
  });

  it('supports legacy Statsig checkGate clients', () => {
    const { result } = renderHook(() => useFeatureFlag(FEATURE_FLAGS.MODE_COMPUTER_USE), {
      wrapper: buildWrapper(true, { legacyOnly: true }),
    });

    expect(result.current).toBe(true);
  });
});

describe('FeatureFlagProvider', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders children inside the provider', () => {
    const { getByText } = render(
      <FeatureFlagProvider
        options={{
          disableLogging: true,
          networkConfig: { preventAllNetworkTraffic: true },
        }}
        sdkKey="client-test-key-render"
        user={{ userID: 'user-1' }}
      >
        <span>ready</span>
      </FeatureFlagProvider>
    );

    expect(getByText('ready')).toBeTruthy();
  });

  it('accepts optional user fields', () => {
    const { getByText, rerender } = render(
      <FeatureFlagProvider
        options={{
          disableLogging: true,
          networkConfig: { preventAllNetworkTraffic: true },
        }}
        sdkKey="client-test-key-fields"
        user={{
          userID: 'user-1',
          email: 'user@example.com',
          custom: { tier: 'pro', seats: 3, active: true },
        }}
      >
        <span>ready</span>
      </FeatureFlagProvider>
    );

    expect(getByText('ready')).toBeTruthy();

    rerender(
      <FeatureFlagProvider
        options={{
          disableLogging: true,
          networkConfig: { preventAllNetworkTraffic: true },
        }}
        sdkKey="client-test-key-fields-updated"
        user={{
          userID: 'user-1',
          email: 'user@example.com',
          custom: { tier: 'team', seats: 4, active: true },
        }}
      >
        <span>updated</span>
      </FeatureFlagProvider>
    );

    expect(getByText('updated')).toBeTruthy();
  });

  it('isolates clients for different users sharing an SDK key', () => {
    const options = {
      disableLogging: true,
      networkConfig: { preventAllNetworkTraffic: true },
    };
    const observedClients = new Map<string, StatsigClient>();

    const Observer = () => {
      const { client } = React.useContext(StatsigContext);
      const statsigClient = client as StatsigClient;
      observedClients.set(statsigClient.getContext().user.userID ?? '', statsigClient);
      return null;
    };

    render(
      <>
        <FeatureFlagProvider
          options={options}
          sdkKey="client-test-key-isolated"
          user={{ userID: 'user-1' }}
        >
          <Observer />
        </FeatureFlagProvider>
        <FeatureFlagProvider
          options={options}
          sdkKey="client-test-key-isolated"
          user={{ userID: 'user-2' }}
        >
          <Observer />
        </FeatureFlagProvider>
      </>
    );

    expect([...observedClients.keys()]).toEqual(['user-1', 'user-2']);
    expect(observedClients.get('user-1')).not.toBe(observedClients.get('user-2'));
  });

  it('replaces the client before children render for a new user', () => {
    const options = {
      disableLogging: true,
      networkConfig: { preventAllNetworkTraffic: true },
    };
    const observedUsers: string[] = [];
    const observedClients: StatsigClient[] = [];

    const Observer = () => {
      const { client } = React.useContext(StatsigContext);
      observedClients.push(client as StatsigClient);
      observedUsers.push((client as StatsigClient).getContext().user.userID ?? '');
      return null;
    };

    const { rerender } = render(
      <FeatureFlagProvider
        options={options}
        sdkKey="client-test-key-user-sync-render"
        user={{ userID: 'user-1' }}
      >
        <Observer />
      </FeatureFlagProvider>
    );

    const firstClient = observedClients.at(-1);
    observedUsers.length = 0;
    observedClients.length = 0;

    rerender(
      <FeatureFlagProvider
        options={options}
        sdkKey="client-test-key-user-sync-render"
        user={{ userID: 'user-2' }}
      >
        <Observer />
      </FeatureFlagProvider>
    );

    expect(observedUsers[0]).toBe('user-2');
    expect(observedClients[0]).not.toBe(firstClient);
    expect(firstClient?.getContext().user.userID).toBe('user-1');
  });

  it('retains the provider-local client when options change for the same user', () => {
    const sdkKey = 'client-test-key-cached-options';
    const observedClients: StatsigClient[] = [];
    const Observer = () => {
      const { client } = React.useContext(StatsigContext);
      observedClients.push(client as StatsigClient);
      return null;
    };
    const { rerender } = render(
      <FeatureFlagProvider
        options={{
          disableLogging: true,
          networkConfig: { preventAllNetworkTraffic: true },
        }}
        sdkKey={sdkKey}
        user={{ userID: 'user-1' }}
      >
        <Observer />
      </FeatureFlagProvider>
    );
    const firstClient = observedClients.at(-1);

    rerender(
      <FeatureFlagProvider
        options={{
          disableLogging: true,
          networkConfig: { preventAllNetworkTraffic: true },
        }}
        sdkKey={sdkKey}
        user={{ userID: 'user-1' }}
      >
        <Observer />
      </FeatureFlagProvider>
    );

    expect(observedClients.at(-1)).toBe(firstClient);
  });
});
