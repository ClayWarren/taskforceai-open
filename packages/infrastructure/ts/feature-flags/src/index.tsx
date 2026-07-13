import { FEATURE_FLAGS, FEATURE_FLAG_DEFAULTS, FeatureFlagKey } from '../definitions/flags';
import { StatsigContext } from '@statsig/react-bindings';
import { StatsigClient, type StatsigOptions, type StatsigUser } from '@statsig/js-client';
import React, { useMemo } from 'react';

type FeatureGateResult = {
  value?: boolean;
  details?: {
    reason?: string;
  };
};

type FeatureGateClient = {
  getFeatureGate: (_name: string) => FeatureGateResult;
};

type LegacyGateClient = {
  checkGate: (_name: string) => boolean | undefined;
};

const shouldUseDefaultForEvaluationReason = (reason: string | undefined): boolean =>
  reason === 'NoValues' ||
  reason === 'Uninitialized' ||
  reason === 'Error:NoClient' ||
  reason?.startsWith('Loading') === true ||
  reason?.endsWith(':Unrecognized') === true;

const isFeatureGateClient = (client: unknown): client is FeatureGateClient =>
  typeof client === 'object' &&
  client !== null &&
  'getFeatureGate' in client &&
  typeof (client as { getFeatureGate?: unknown }).getFeatureGate === 'function';

const isLegacyGateClient = (client: unknown): client is LegacyGateClient =>
  typeof client === 'object' &&
  client !== null &&
  'checkGate' in client &&
  typeof (client as { checkGate?: unknown }).checkGate === 'function';

const isNoopClient = (client: unknown): boolean =>
  typeof client === 'object' &&
  client !== null &&
  'isNoop' in client &&
  (client as { isNoop?: boolean }).isNoop === true;

/**
 * Hook to check if a feature flag is enabled for the current user.
 *
 * @example
 * const isComputerUseEnabled = useFeatureFlag(FEATURE_FLAGS.MODE_COMPUTER_USE);
 */
export const useFeatureFlag = (flag: FeatureFlagKey): boolean => {
  const { client, renderVersion, isLoading } = React.useContext(StatsigContext);

  return React.useMemo(() => {
    void renderVersion;
    const contextClient: unknown = client;

    // When no provider is mounted, Statsig context contains a Noop client.
    if (
      isLoading ||
      typeof contextClient !== 'object' ||
      contextClient === null ||
      isNoopClient(contextClient)
    ) {
      return FEATURE_FLAG_DEFAULTS[flag];
    }

    if (isFeatureGateClient(contextClient)) {
      const gate = contextClient.getFeatureGate(flag);
      if (shouldUseDefaultForEvaluationReason(gate.details?.reason)) {
        return FEATURE_FLAG_DEFAULTS[flag];
      }
      return gate.value ?? FEATURE_FLAG_DEFAULTS[flag];
    }

    if (isLegacyGateClient(contextClient)) {
      return contextClient.checkGate(flag) ?? FEATURE_FLAG_DEFAULTS[flag];
    }

    return FEATURE_FLAG_DEFAULTS[flag];
  }, [client, renderVersion, isLoading, flag]);
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

let suppressedStatsigRenderNotificationDepth = 0;

const withoutStatsigRenderNotification = (update: () => void) => {
  suppressedStatsigRenderNotificationDepth += 1;
  try {
    update();
  } finally {
    suppressedStatsigRenderNotificationDepth -= 1;
  }
};

const createStatsigClientEntry = (
  sdkKey: string,
  user: StatsigUser,
  userKey: string,
  options?: StatsigOptions
): CachedStatsigClient => ({
  client: new StatsigClient(sdkKey, user, options),
  initialized: false,
  userKey,
});

const updateCachedStatsigClientUser = (
  entry: CachedStatsigClient,
  sdkKey: string,
  user: StatsigUser,
  userKey: string,
  options?: StatsigOptions
): CachedStatsigClient => {
  if (entry.userKey === userKey) {
    return entry;
  }

  if (!entry.initialized) {
    return createStatsigClientEntry(sdkKey, user, userKey, options);
  }

  withoutStatsigRenderNotification(() => {
    entry.client.updateUserSync(user);
  });
  entry.userKey = userKey;
  return entry;
};

const getOrCreateStatsigClient = (
  sdkKey: string,
  user: StatsigUser,
  userKey: string,
  options?: StatsigOptions
): CachedStatsigClient => {
  const cache = getStatsigClientCache();
  const cacheKey = getStatsigClientCacheKey(sdkKey);
  const cached = cache.get(cacheKey);
  if (cached) {
    const entry = updateCachedStatsigClientUser(cached, sdkKey, user, userKey, options);
    cache.set(cacheKey, entry);
    return entry;
  }

  const legacyCacheKeyPrefix = getLegacyStatsigClientCacheKeyPrefix(sdkKey);
  // The global cache can survive HMR in development; migrate old per-user entries if present.
  for (const [legacyCacheKey, legacyEntry] of cache) {
    if (legacyCacheKey.startsWith(legacyCacheKeyPrefix)) {
      cache.delete(legacyCacheKey);
      const entry = updateCachedStatsigClientUser(legacyEntry, sdkKey, user, userKey, options);
      cache.set(cacheKey, entry);
      return entry;
    }
  }

  const entry = createStatsigClientEntry(sdkKey, user, userKey, options);
  cache.set(cacheKey, entry);
  return entry;
};

const isStatsigClientReady = (client: StatsigClient): boolean => client.loadingStatus === 'Ready';

const updateClientRender = (
  client: StatsigClient,
  onRenderVersion: React.Dispatch<React.SetStateAction<number>>,
  onLoading: React.Dispatch<React.SetStateAction<boolean>>
) => {
  if (suppressedStatsigRenderNotificationDepth > 0) {
    return;
  }

  onRenderVersion((version) => version + 1);
  onLoading(!isStatsigClientReady(client));
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
  const entry = useMemo(
    () => getOrCreateStatsigClient(sdkKey, user, userKey, options),
    [sdkKey, user, userKey, options]
  );
  const [renderVersion, setRenderVersion] = React.useState(0);
  const [isLoading, setIsLoading] = React.useState(() => !isStatsigClientReady(entry.client));

  React.useEffect(() => {
    const onValuesUpdated = () => updateClientRender(entry.client, setRenderVersion, setIsLoading);

    entry.client.$on('values_updated', onValuesUpdated);
    setIsLoading(!isStatsigClientReady(entry.client));

    if (!entry.initialized) {
      entry.initialized = true;
      entry.client.initializeSync();
    }

    return () => {
      entry.client.off('values_updated', onValuesUpdated);
      entry.client.flush().catch(() => undefined);
    };
  }, [entry]);

  const contextValue = React.useMemo(
    () => ({
      client: entry.client,
      renderVersion,
      isLoading,
    }),
    [entry.client, renderVersion, isLoading]
  );

  return <StatsigContext.Provider value={contextValue}>{children}</StatsigContext.Provider>;
};

export { FEATURE_FLAGS };
