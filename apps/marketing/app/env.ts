type MarketingEnv = Readonly<{
  NEXT_PUBLIC_MOBILE_IOS_APP_URL: string | undefined;
  NEXT_PUBLIC_MOBILE_ANDROID_APP_URL: string | undefined;
}>;

type RuntimeEnvSource = Record<string, string | undefined>;

const readImportMetaEnv = (): RuntimeEnvSource | undefined =>
  (import.meta as ImportMeta & { env?: RuntimeEnvSource }).env;

const getRuntimeEnv = (key: keyof MarketingEnv): string | undefined => {
  if (typeof process !== 'undefined' && process.env?.[key] !== undefined) {
    return process.env[key];
  }

  const importMetaEnv = readImportMetaEnv();
  if (importMetaEnv?.[key] !== undefined) {
    // coverage-ignore-next-line -- import.meta.env is supplied by Vite and not rewired by Bun tests.
    return importMetaEnv[key];
  }

  const browserEnv =
    typeof window !== 'undefined'
      ? (window as { process?: { env?: RuntimeEnvSource } }).process?.env
      : undefined;

  return browserEnv?.[key];
};

export const createMarketingEnv = (): MarketingEnv => ({
  NEXT_PUBLIC_MOBILE_IOS_APP_URL: getRuntimeEnv('NEXT_PUBLIC_MOBILE_IOS_APP_URL'),
  NEXT_PUBLIC_MOBILE_ANDROID_APP_URL: getRuntimeEnv('NEXT_PUBLIC_MOBILE_ANDROID_APP_URL'),
});

export const env = createMarketingEnv();
