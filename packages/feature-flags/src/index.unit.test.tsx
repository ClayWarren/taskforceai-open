import { render, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import '../../../tests/setup/dom';
import { FeatureFlagProvider, useFeatureFlag, FEATURE_FLAGS } from './index';
import { StatsigContext } from '@statsig/react-bindings';
import { StatsigClient } from '@statsig/js-client';

const clearStatsigClientCache = () => {
  delete (globalThis as typeof globalThis & { __taskforceaiStatsigClients?: unknown })
    .__taskforceaiStatsigClients;
};

function buildWrapper(gateValue: boolean | undefined, options?: { isLoading?: boolean }) {
  const contextValue = {
    renderVersion: 1,
    isLoading: options?.isLoading ?? false,
    client: {
      checkGate: mock(() => gateValue),
    },
  };

  return ({ children }: { children: React.ReactNode }) => (
    <StatsigContext.Provider value={contextValue as any}>{children}</StatsigContext.Provider>
  );
}

describe('useFeatureFlag', () => {
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
});

describe('FeatureFlagProvider', () => {
  beforeEach(() => {
    clearStatsigClientCache();
  });

  it('renders children inside the provider', () => {
    const { getByText } = render(
      <FeatureFlagProvider
        options={{ disableLogging: true, networkConfig: { preventAllNetworkTraffic: true } }}
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
        options={{ disableLogging: true, networkConfig: { preventAllNetworkTraffic: true } }}
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
        options={{ disableLogging: true, networkConfig: { preventAllNetworkTraffic: true } }}
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

  it('reuses one Statsig client per SDK key when the authenticated user changes', () => {
    const options = { disableLogging: true, networkConfig: { preventAllNetworkTraffic: true } };
    const { rerender } = render(
      <FeatureFlagProvider
        options={options}
        sdkKey="client-test-key-user-cache"
        user={{ userID: 'user-1' }}
      >
        <span>ready</span>
      </FeatureFlagProvider>
    );

    rerender(
      <FeatureFlagProvider
        options={options}
        sdkKey="client-test-key-user-cache"
        user={{ userID: 'user-2' }}
      >
        <span>ready</span>
      </FeatureFlagProvider>
    );

    const cache = (
      globalThis as typeof globalThis & {
        __taskforceaiStatsigClients?: Map<string, unknown>;
      }
    ).__taskforceaiStatsigClients;
    expect(cache?.size).toBe(1);
    expect([...cache!.keys()]).toEqual(['client-test-key-user-cache']);
    expect(
      (cache!.get('client-test-key-user-cache') as { userKey?: string } | undefined)?.userKey
    ).toBe('{"userID":"user-2"}');
  });

  it('migrates legacy per-user cache entries to the SDK-key cache entry', () => {
    const options = { disableLogging: true, networkConfig: { preventAllNetworkTraffic: true } };
    const sdkKey = 'client-test-key-legacy-cache';
    const user = { userID: 'user-legacy' };
    const userKey = JSON.stringify(user);
    const legacyEntry = {
      client: new StatsigClient(sdkKey, user, options),
      initialized: false,
      userKey,
    };
    const cache = new Map<string, unknown>([[`${sdkKey}:${userKey}`, legacyEntry]]);
    (
      globalThis as typeof globalThis & {
        __taskforceaiStatsigClients?: Map<string, unknown>;
      }
    ).__taskforceaiStatsigClients = cache;

    render(
      <FeatureFlagProvider options={options} sdkKey={sdkKey} user={user}>
        <span>ready</span>
      </FeatureFlagProvider>
    );

    expect([...cache.keys()]).toEqual([sdkKey]);
    expect(cache.get(sdkKey)).toBe(legacyEntry);
  });
});
