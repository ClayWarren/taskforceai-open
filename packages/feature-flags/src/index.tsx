import { FEATURE_FLAGS, FEATURE_FLAG_DEFAULTS, FeatureFlagKey } from '../definitions/flags';
import { StatsigContext, StatsigProvider as BaseStatsigProvider } from '@statsig/react-bindings';
import { StatsigClient, type StatsigOptions, type StatsigUser } from '@statsig/js-client';
import React, { useMemo } from 'react';

/**
 * Hook to check if a feature flag is enabled for the current user.
 *
 * @example
 * const isComputerUseEnabled = useFeatureFlag(FEATURE_FLAGS.MODE_COMPUTER_USE);
 */
export const useFeatureFlag = (flag: FeatureFlagKey): boolean => {
  const { client, renderVersion, isLoading } = React.useContext(StatsigContext);

  return React.useMemo(() => {
    // When no provider is mounted, Statsig context contains a Noop client.
    if (
      isLoading ||
      typeof client !== 'object' ||
      client === null ||
      !('checkGate' in client) ||
      ('isNoop' in client && (client as { isNoop?: boolean }).isNoop === true)
    ) {
      return FEATURE_FLAG_DEFAULTS[flag];
    }

    const gate = (client as { checkGate: (_name: string) => boolean | undefined }).checkGate(flag);
    return gate ?? FEATURE_FLAG_DEFAULTS[flag];
  }, [client, renderVersion, flag]);
};

interface FeatureFlagProviderProps {
  children: React.ReactNode;
  user: StatsigUser;
  sdkKey: string;
  options?: StatsigOptions;
}

type CachedStatsigClient = {
  client: StatsigClient;
  initialized: boolean;
  userKey: string;
};

const getStatsigClientCache = (): Map<string, CachedStatsigClient> => {
  const globalKey = '__taskforceaiStatsigClients';
  const globalObject = globalThis as typeof globalThis & {
    [globalKey]?: Map<string, CachedStatsigClient>;
  };
  globalObject[globalKey] ??= new Map<string, CachedStatsigClient>();
  return globalObject[globalKey];
};

const getStatsigUserKey = (user: StatsigUser) => JSON.stringify(user);
const getStatsigClientCacheKey = (sdkKey: string) => sdkKey;

const getLegacyStatsigClientCacheKeyPrefix = (sdkKey: string) => `${sdkKey}:`;

const getOrCreateStatsigClient = (
  sdkKey: string,
  user: StatsigUser,
  options?: StatsigOptions
): CachedStatsigClient => {
  const cache = getStatsigClientCache();
  const userKey = getStatsigUserKey(user);
  const cacheKey = getStatsigClientCacheKey(sdkKey);
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const legacyCacheKeyPrefix = getLegacyStatsigClientCacheKeyPrefix(sdkKey);
  for (const [legacyCacheKey, legacyEntry] of cache) {
    if (legacyCacheKey.startsWith(legacyCacheKeyPrefix)) {
      cache.delete(legacyCacheKey);
      cache.set(cacheKey, legacyEntry);
      return legacyEntry;
    }
  }

  const entry = {
    client: new StatsigClient(sdkKey, user, options),
    initialized: false,
    userKey,
  };
  cache.set(cacheKey, entry);
  return entry;
};

/**
 * Provider that initializes the Statsig SDK and provides feature flag context to the app.
 */
export const FeatureFlagProvider: React.FC<FeatureFlagProviderProps> = ({
  children,
  user,
  sdkKey,
  options,
}) => {
  const userKey = getStatsigUserKey(user);
  const entry = useMemo(() => getOrCreateStatsigClient(sdkKey, user, options), [sdkKey, options]);

  React.useEffect(() => {
    if (!entry.initialized) {
      entry.initialized = true;
      entry.client.initializeSync();
    }

    if (entry.userKey !== userKey) {
      entry.client.updateUserSync(user);
      entry.userKey = userKey;
    }
  }, [entry, user, userKey]);

  return <BaseStatsigProvider client={entry.client}>{children}</BaseStatsigProvider>;
};

export { FEATURE_FLAGS };
