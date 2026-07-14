const DEFAULT_BOOTSTRAP_ORIGIN = 'https://taskforceai.chat';

const normalizeOrigin = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(withProtocol);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
};

const isLoopbackOrigin = (origin: string): boolean => {
  try {
    const { hostname, protocol } = new URL(origin);
    return (
      (protocol === 'http:' || protocol === 'https:') &&
      (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1')
    );
  } catch {
    return false;
  }
};

const readEnvValue = (env: unknown, key: string): string | undefined => {
  if (!env || typeof env !== 'object') {
    return undefined;
  }
  const value = (env as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
};

const getTrustedConfiguredOrigins = (
  env: unknown = process.env
): { origins: Set<string>; fallback: string } => {
  const configured = [
    normalizeOrigin(readEnvValue(env, 'VITE_SITE_URL')),
    normalizeOrigin(readEnvValue(env, 'NEXT_PUBLIC_SITE_URL')),
    normalizeOrigin(readEnvValue(env, 'VERCEL_PROJECT_PRODUCTION_URL')),
    normalizeOrigin(readEnvValue(env, 'VERCEL_URL')),
    DEFAULT_BOOTSTRAP_ORIGIN,
  ].filter((origin): origin is string => Boolean(origin));

  return {
    origins: new Set(configured),
    fallback: configured[0] ?? DEFAULT_BOOTSTRAP_ORIGIN,
  };
};

export const resolveBootstrapOrigin = (
  requestOrigin: string,
  env: unknown = process.env
): string => {
  const { origins, fallback } = getTrustedConfiguredOrigins(env);
  const normalizedRequestOrigin = normalizeOrigin(requestOrigin);

  if (normalizedRequestOrigin && origins.has(normalizedRequestOrigin)) {
    return normalizedRequestOrigin;
  }

  if (normalizedRequestOrigin && isLoopbackOrigin(normalizedRequestOrigin)) {
    return normalizedRequestOrigin;
  }

  return fallback;
};
