export const taskforceDomain = 'taskforceai.chat';

export const trimTrailingSlashes = (value: string): string => value.trim().replace(/\/+$/, '');

export const getAuthEnvironmentVariable = (name: string): string | undefined => {
  if (typeof process !== 'undefined' && process.env) {
    return process.env[name];
  }
  if (typeof (import.meta as any).env !== 'undefined') {
    return (import.meta as any).env[name];
  }
  return undefined;
};

const getBaseUrl = () =>
  trimTrailingSlashes(getAuthEnvironmentVariable('NEXT_PUBLIC_API_URL') ?? '') ||
  'http://localhost:3000';

export const getAuthBaseUrl = (): string => {
  if (typeof window === 'undefined') {
    return getBaseUrl();
  }
  const authUrl = trimTrailingSlashes(getAuthEnvironmentVariable('NEXT_PUBLIC_AUTH_URL') ?? '');
  if (authUrl) return authUrl;

  if ('__TAURI__' in window) {
    return `https://${taskforceDomain}`;
  }

  return '';
};

// Browser token reads stay same-origin so raw session tokens are never exposed
// through CORS. Web apps proxy this path to the auth service; native clients
// continue to use their configured auth origin directly.
export const getAuthTokenBaseUrl = (): string => {
  if (typeof window !== 'undefined' && !('__TAURI__' in window)) {
    return '';
  }
  return getAuthBaseUrl();
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
