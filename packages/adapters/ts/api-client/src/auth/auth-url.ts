export const taskforceDomain = 'taskforceai.chat';

export const trimTrailingSlashes = (value: string): string => value.trim().replace(/\/+$/, '');

export type AuthRuntimeConfig = Readonly<{
  apiUrl?: string;
  authUrl?: string;
}>;

const configuredUrl = (value: string | undefined): string => {
  return trimTrailingSlashes(value ?? '');
};

const getBaseUrl = (config: AuthRuntimeConfig): string =>
  configuredUrl(config.apiUrl) || 'http://localhost:3000';

export const getAuthBaseUrl = (config: AuthRuntimeConfig = {}): string => {
  if (typeof window === 'undefined') {
    return getBaseUrl(config);
  }
  const authUrl = configuredUrl(config.authUrl);
  if (authUrl) return authUrl;

  if ('__TAURI__' in window) {
    return `https://${taskforceDomain}`;
  }

  return '';
};

// Browser token reads stay same-origin so raw session tokens are never exposed
// through CORS. Web apps proxy this path to the auth service; native clients
// continue to use their configured auth origin directly.
export const getAuthTokenBaseUrl = (config: AuthRuntimeConfig = {}): string => {
  if (typeof window !== 'undefined' && !('__TAURI__' in window)) {
    return '';
  }
  return getAuthBaseUrl(config);
};

export const joinBaseAndPath = (baseUrl: string, path: string): string => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const normalizedBase = trimTrailingSlashes(baseUrl);
  if (!normalizedBase) {
    return normalizedPath;
  }
  return `${normalizedBase}${normalizedPath}`;
};

export const getAuthPath = (path: string): string => `/api/auth/${path.replace(/^\/+/, '')}`;
