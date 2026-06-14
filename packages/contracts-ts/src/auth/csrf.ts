/**
 * CSRF Management for the Web Application
 */
import { getAuthLogger } from './logger';

let cachedToken: string | null = null;
let tokenExpiry = 0;
const logger = getAuthLogger();

const getCookieToken = (): string | null => {
  if (typeof document === 'undefined') {
    return '';
  }

  const cookiePrefix = 'csrf_token=';
  const cookies = document.cookie.split(';');
  for (const rawCookie of cookies) {
    const cookie = rawCookie.trim();
    if (cookie.startsWith(cookiePrefix)) {
      const value = cookie.slice(cookiePrefix.length);
      if (value) {
        try {
          return decodeURIComponent(value);
        } catch (error) {
          logger.warn('Failed to decode csrf cookie token', { error });
          return null;
        }
      }
    }
  }

  return '';
};

/**
 * Fetches a fresh CSRF token from the Auth service.
 * Automatically handles the Double Submit Cookie pattern required by the backend.
 */
export const getCsrfToken = async (forceRefresh = false): Promise<string> => {
  const now = Date.now();
  const cookieToken = getCookieToken();

  if (cookieToken === null) {
    if (!forceRefresh) {
      return '';
    }
  }

  if (!forceRefresh && cookieToken && cookieToken.length > 0) {
    // Only refresh the in-memory cache if it has actually expired or the token changed.
    // Without this guard, every call with a cookie present resets the 45-min timer,
    // allowing a stale cookie token to persist indefinitely.
    if (cachedToken !== cookieToken || now >= tokenExpiry) {
      cachedToken = cookieToken;
      tokenExpiry = now + 2700 * 1000;
    }
    return cookieToken;
  }

  try {
    // Auth client already has a getAuthPath helper
    // We can reach out to /api/auth/csrf
    const response = await fetch('/api/auth/csrf', {
      credentials: 'include',
    });

    if (!response.ok) {
      return '';
    }

    const data = (await response.json()) as { csrfToken?: string };
    const refreshedCookieToken = getCookieToken();
    if (!refreshedCookieToken) {
      cachedToken = null;
      tokenExpiry = 0;
      if (typeof data.csrfToken === 'string' && data.csrfToken.length > 0) {
        logger.warn('CSRF endpoint returned a token without a readable csrf cookie');
      }
      return '';
    }

    cachedToken = refreshedCookieToken;
    tokenExpiry = now + 2700 * 1000; // Cache for 45 minutes (server uses 1 hour)
    return cachedToken;
  } catch (error) {
    logger.error('Failed to fetch CSRF token', { error });
    return '';
  }
};

/**
 * Helper to add CSRF headers to a Headers object or init object.
 */
export const withCsrf = async (init: RequestInit = {}): Promise<RequestInit> => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(init.method?.toUpperCase() || 'GET')) {
    return init;
  }

  const token = await getCsrfToken();
  if (!token) return init;

  const headers = new Headers(init.headers);
  headers.set('X-CSRF-Token', token);

  return {
    ...init,
    headers,
  };
};
