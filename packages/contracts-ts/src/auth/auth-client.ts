import { z } from 'zod';
import { definedProps } from '@taskforceai/shared/utils/object';

import { getAuthLogger } from './logger';

export type Session = {
  user?: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
  expires: string;
};

const logger = getAuthLogger();
const taskforceDomain = 'taskforceai.chat';
const trimTrailingSlashes = (value: string): string => value.trim().replace(/\/+$/, '');

const sessionResponseSchema = z.object({
  user: z.object({
    name: z.string().nullable().optional(),
    email: z.string().min(1),
    image: z.string().nullable().optional(),
  }),
  expires: z.string().min(1),
});

const tokenResponseSchema = z
  .object({
    accessToken: z.string().min(1).optional(),
    access_token: z.string().min(1).optional(),
  })
  .refine((value) => value.accessToken || value.access_token, {
    message: 'Token response must include accessToken or access_token',
  });

const csrfResponseSchema = z.object({
  csrfToken: z.string().min(1).optional(),
});

const signOutResponseSchema = z.object({
  url: z.string().optional(),
});

const formatValidationIssues = (error: z.ZodError) =>
  error.issues.map((issue) => ({
    code: issue.code,
    path: issue.path.join('.'),
    message: issue.message,
  }));

const readJsonPayload = async (response: Response, label: string): Promise<unknown> => {
  try {
    return await response.json();
  } catch (error) {
    logger.warn(`${label} JSON parsing failed`, { error });
    return {};
  }
};

const normalizeHostname = (hostname: string): string =>
  hostname.trim().toLowerCase().replace(/\.+$/, '');

const isDnsHostname = (hostname: string): boolean => {
  if (!hostname) return false;
  if (hostname.startsWith('.') || hostname.endsWith('.') || hostname.includes('..')) return false;
  return /^[a-z0-9.-]+$/.test(hostname);
};

const isTrustedTaskforceHostname = (hostname: string): boolean => {
  const normalizedHostname = normalizeHostname(hostname);
  if (!isDnsHostname(normalizedHostname)) return false;

  return (
    normalizedHostname === taskforceDomain || normalizedHostname.endsWith(`.${taskforceDomain}`)
  );
};

const getEnvVar = (name: string): string | undefined => {
  if (typeof process !== 'undefined' && process.env) {
    return process.env[name];
  }
  if (typeof (import.meta as any).env !== 'undefined') {
    return (import.meta as any).env[name];
  }
  return undefined;
};

const getBaseUrl = () =>
  trimTrailingSlashes(getEnvVar('NEXT_PUBLIC_API_URL') ?? '') || 'http://localhost:3000';

const getAuthBaseUrl = () => {
  if (typeof window === 'undefined') {
    return getBaseUrl();
  }
  const authUrl = trimTrailingSlashes(getEnvVar('NEXT_PUBLIC_AUTH_URL') ?? '');
  if (authUrl) return authUrl;

  // Production fallback
  const hostname =
    typeof window !== 'undefined' && typeof window.location?.hostname === 'string'
      ? window.location.hostname
      : '';
  if (isTrustedTaskforceHostname(hostname)) {
    // Prefer relative paths for trusted hostnames to avoid CORS issues
    // and take advantage of same-origin cookie handling/proxies.
    return '';
  }

  return '';
};

const getSignInBaseUrl = () => {
  if (typeof window === 'undefined') {
    return trimTrailingSlashes(getEnvVar('NEXT_PUBLIC_AUTH_URL') ?? '');
  }
  const authUrl = trimTrailingSlashes(getEnvVar('NEXT_PUBLIC_AUTH_URL') ?? '');
  if (authUrl) return authUrl;

  const hostname =
    typeof window !== 'undefined' && typeof window.location?.hostname === 'string'
      ? window.location.hostname
      : '';
  if (isTrustedTaskforceHostname(hostname)) {
    return 'https://auth.taskforceai.chat';
  }

  return '';
};

const joinBaseAndPath = (baseUrl: string, path: string): string => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const normalizedBase = trimTrailingSlashes(baseUrl);
  if (!normalizedBase) {
    return normalizedPath;
  }
  return `${normalizedBase}${normalizedPath}`;
};

const getAuthPath = (path: string) => {
  return `/api/auth/${path.replace(/^\/+/, '')}`;
};

function isValidCallbackUrl(url: string): boolean {
  const normalizedUrl = url.trim();
  if (!normalizedUrl) return false;
  if (normalizedUrl.startsWith('//')) return false;
  if (normalizedUrl.startsWith('/\\')) return false;
  if (normalizedUrl.startsWith('/')) return true; // relative paths OK
  try {
    const parsed = new URL(normalizedUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    if (typeof window === 'undefined') {
      return false;
    }
    return parsed.origin === window.location.origin;
  } catch {
    return false;
  }
}

const stripQueryAndHash = (value: string): string => {
  const withoutHash = value.split('#')[0] ?? value;
  const withoutQuery = withoutHash.split('?')[0] ?? withoutHash;
  return withoutQuery || '/';
};

const isUpgradePlan = (value: string | null): value is 'pro' | 'super' =>
  value === 'pro' || value === 'super';

const appendAllowedCallbackParams = (target: string, source: URL): string => {
  const plan = source.searchParams.get('plan');
  if (!isUpgradePlan(plan)) {
    return target;
  }

  const separator = target.includes('?') ? '&' : '?';
  return `${target}${separator}plan=${plan}`;
};

const sanitizeCallbackUrl = (callbackUrl: string): string => {
  const normalizedUrl = callbackUrl.trim();
  if (!isValidCallbackUrl(normalizedUrl)) {
    return '/';
  }

  if (normalizedUrl.startsWith('/')) {
    const stripped = stripQueryAndHash(normalizedUrl);
    const parsed = new URL(normalizedUrl, 'https://taskforceai.local');
    return appendAllowedCallbackParams(stripped, parsed);
  }

  const parsed = new URL(normalizedUrl);
  return appendAllowedCallbackParams(`${parsed.origin}${parsed.pathname}`, parsed);
};

/**
 * Decoupled Auth Client
 * This client handles authentication by talking directly to the Go server.
 */
export const authClient = {
  _config: {
    baseUrl: undefined as string | undefined,
    getTokenProvider: undefined as (() => Promise<string | null>) | undefined,
    fetchImpl: undefined as typeof fetch | undefined,
  },

  configure(config: {
    baseUrl?: string;
    getTokenProvider?: () => Promise<string | null>;
    fetchImpl?: typeof fetch;
  }) {
    this._config = { ...this._config, ...config };
  },

  getSignInUrl(options: Record<string, any> = {}): string {
    const { callbackUrl = '/' } = options;
    const safeCallbackUrl = sanitizeCallbackUrl(callbackUrl);

    const base = this._config.baseUrl || getSignInBaseUrl();
    const authPath = joinBaseAndPath(base, '/api/v1/auth/login');

    const separator = authPath.includes('?') ? '&' : '?';
    return `${authPath}${separator}callbackUrl=${encodeURIComponent(safeCallbackUrl)}`;
  },

  async getSession(): Promise<Session | null> {
    try {
      const base = this._config.baseUrl || getAuthBaseUrl();
      const url = joinBaseAndPath(base, getAuthPath('session'));
      const token = this._config.getTokenProvider ? await this._config.getTokenProvider() : null;
      const fetchImpl = this._config.fetchImpl ?? fetch.bind(globalThis);

      const response = await fetchImpl(url, {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
      });

      if (!response.ok) {
        return null;
      }

      const parsed = sessionResponseSchema.safeParse(
        await readJsonPayload(response, 'Session response')
      );
      if (!parsed.success) {
        logger.warn('Session response failed validation', {
          issues: formatValidationIssues(parsed.error),
        });
        return null;
      }

      const session = parsed.data;
      return {
        expires: session.expires,
        user: {
          email: session.user.email,
          ...definedProps({
            name: session.user.name,
            image: session.user.image,
          }),
        },
      };
    } catch (error) {
      // Standardize session fetch failures as warnings or info since they are common during boot/offline
      const isNetworkError = error instanceof TypeError || (error as any)?.name === 'AbortError';
      if (isNetworkError) {
        logger.debug('Session check bypassed (network/aborted)', { error });
      } else {
        logger.warn('Failed to fetch session', { error });
      }
      return null;
    }
  },

  async getToken(): Promise<string | null> {
    if (this._config.getTokenProvider) {
      return this._config.getTokenProvider();
    }

    try {
      const base = this._config.baseUrl || getAuthBaseUrl();
      const fetchImpl = this._config.fetchImpl ?? fetch.bind(globalThis);
      const response = await fetchImpl(joinBaseAndPath(base, '/api/v1/auth/token'), {
        credentials: 'include',
      });

      if (!response.ok) {
        return null;
      }

      const parsed = tokenResponseSchema.safeParse(
        await readJsonPayload(response, 'Auth token response')
      );
      if (!parsed.success) {
        logger.warn('Auth token response failed validation', {
          issues: formatValidationIssues(parsed.error),
        });
        return null;
      }
      return parsed.data.accessToken ?? parsed.data.access_token ?? null;
    } catch (error) {
      const isNetworkError = error instanceof TypeError || (error as any)?.name === 'AbortError';
      if (isNetworkError) {
        logger.debug('Token fetch bypassed (network/aborted)', { error });
      } else {
        logger.warn('Failed to fetch auth token', { error });
      }
      return null;
    }
  },

  async signIn(provider: string, options: Record<string, any> = {}): Promise<any> {
    const { callbackUrl } = options;
    const fallbackUrl = typeof window !== 'undefined' ? window.location.origin : '/';
    const finalCallbackUrl = callbackUrl || fallbackUrl;

    const supportedProviders = ['google', 'github', 'authkit', 'apple'];
    if (!supportedProviders.includes(provider)) {
      throw new Error(`Unsupported provider: ${provider}`);
    }

    const url = this.getSignInUrl({ callbackUrl: finalCallbackUrl });
    if (typeof window !== 'undefined') {
      window.location.href = url;
    }
    return;
  },

  async signOut(options: { callbackUrl?: string; redirect?: boolean } = {}): Promise<void> {
    const { callbackUrl, redirect = true } = options;
    const fallbackUrl = typeof window !== 'undefined' ? window.location.origin : '/';
    const finalCallbackUrl = callbackUrl || fallbackUrl;
    const safeCallbackUrl = sanitizeCallbackUrl(finalCallbackUrl);

    try {
      const base = this._config.baseUrl || getAuthBaseUrl();
      const csrfUrl = joinBaseAndPath(base, getAuthPath('csrf'));
      const fetchImpl = this._config.fetchImpl ?? fetch.bind(globalThis);
      const csrfResponse = await fetchImpl(csrfUrl, { credentials: 'include' });
      const parsedCsrf = csrfResponseSchema.safeParse(
        await readJsonPayload(csrfResponse, 'Sign-out CSRF response')
      );
      if (!parsedCsrf.success) {
        logger.warn('Sign-out CSRF response failed validation', {
          issues: formatValidationIssues(parsedCsrf.error),
        });
      }
      const csrfToken = parsedCsrf.success ? (parsedCsrf.data.csrfToken ?? '') : '';

      const signOutUrl = joinBaseAndPath(base, getAuthPath('signout'));
      const response = await fetchImpl(signOutUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-CSRF-Token': csrfToken,
        },
        body: new URLSearchParams({
          csrfToken,
          callbackUrl: safeCallbackUrl,
          json: 'true',
        }),
        credentials: 'include',
      });

      const parsedSignOut = signOutResponseSchema.safeParse(
        await readJsonPayload(response, 'Sign-out response')
      );
      if (!parsedSignOut.success) {
        logger.warn('Sign-out response failed validation', {
          issues: formatValidationIssues(parsedSignOut.error),
        });
      }
      const data = parsedSignOut.success ? parsedSignOut.data : {};

      if (redirect && typeof window !== 'undefined') {
        const serverUrl = data.url ?? '';
        const targetUrl = isValidCallbackUrl(serverUrl) ? serverUrl : safeCallbackUrl;
        window.location.href = targetUrl;
      }
    } catch (error) {
      logger.error('Sign out failed', { error });
      if (redirect && typeof window !== 'undefined') {
        window.location.href = safeCallbackUrl;
      }
    }
  },
};
