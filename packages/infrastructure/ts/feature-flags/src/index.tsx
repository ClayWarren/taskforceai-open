import { FEATURE_FLAGS, FEATURE_FLAG_DEFAULTS, FeatureFlagKey } from '../definitions/flags';
import { StatsigContext } from '@statsig/react-bindings';
import { StatsigClient, type StatsigOptions, type StatsigUser } from '@statsig/js-client';
import React from 'react';

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

type StatsigClientEntry = {
  client: StatsigClient;
};

const getStatsigUserKey = (user: StatsigUser) => JSON.stringify(user);

const createStatsigClientEntry = (
  sdkKey: string,
  user: StatsigUser,
  options?: StatsigOptions
): StatsigClientEntry => ({
  client: new StatsigClient(sdkKey, user, options),
});

const isStatsigClientReady = (client: StatsigClient): boolean => client.loadingStatus === 'Ready';

const updateClientRender = (
  client: StatsigClient,
  onRenderVersion: React.Dispatch<React.SetStateAction<number>>,
  onLoading: React.Dispatch<React.SetStateAction<boolean>>
) => {
  onRenderVersion((version) => version + 1);
  onLoading(!isStatsigClientReady(client));
};

const FeatureFlagProviderSession: React.FC<FeatureFlagProviderProps> = ({
  children,
  user,
  sdkKey,
  options,
}) => {
  const initialConfig = React.useRef({ sdkKey, user, options });
  const [entry, setEntry] = React.useState<StatsigClientEntry | null>(null);
  const [renderVersion, setRenderVersion] = React.useState(0);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    const nextEntry = createStatsigClientEntry(
      initialConfig.current.sdkKey,
      initialConfig.current.user,
      initialConfig.current.options
    );
    const onValuesUpdated = () =>
      updateClientRender(nextEntry.client, setRenderVersion, setIsLoading);

    nextEntry.client.$on('values_updated', onValuesUpdated);
    nextEntry.client.initializeSync();
    setIsLoading(!isStatsigClientReady(nextEntry.client));
    setEntry(nextEntry);

    return () => {
      nextEntry.client.off('values_updated', onValuesUpdated);
      nextEntry.client.shutdown().catch(() => undefined);
    };
  }, []);

  const contextValue = React.useMemo(
    () =>
      entry
        ? {
            client: entry.client,
            renderVersion,
            isLoading,
          }
        : null,
    [entry, renderVersion, isLoading]
  );

  if (!contextValue) return null;
  return <StatsigContext.Provider value={contextValue}>{children}</StatsigContext.Provider>;
};

/**
 * Provider that initializes an isolated Statsig SDK client for one authenticated user.
 */
export const FeatureFlagProvider: React.FC<FeatureFlagProviderProps> = (props) => {
  const sessionKey = `${props.sdkKey}:${getStatsigUserKey(props.user)}`;
  return <FeatureFlagProviderSession key={sessionKey} {...props} />;
};

export { FEATURE_FLAGS };
