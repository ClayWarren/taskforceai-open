'use client';

import { type Result, err, ok } from '../result';

export type CookieError = {
  kind: 'unavailable' | 'missing' | 'failed';
  message: string;
};

const fallbackCookies = new Map<string, string>();

const parseCookieAssignment = (cookie: string): { name: string; value: string } | null => {
  const trimmed = cookie.trim();
  if (!trimmed) {
    return null;
  }
  const [pair] = trimmed.split(';');
  if (!pair) {
    return null;
  }
  const separatorIndex = pair.indexOf('=');
  if (separatorIndex <= 0) {
    return null;
  }
  return {
    name: pair.slice(0, separatorIndex),
    value: pair.slice(separatorIndex + 1),
  };
};

const isDeletionCookie = (cookie: string): boolean =>
  /expires=Thu, 01 Jan 1970/i.test(cookie) || /max-age=0/i.test(cookie);

export const readCookie = (name: string): string | null => {
  if (typeof document === 'undefined') {
    return fallbackCookies.get(name) ?? null;
  }
  const nameEQ = `${name}=`;
  const ca = document.cookie.split(';');
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c && c.charAt(0) === ' ') c = c.substring(1);
    if (c && c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length);
  }
  return null;
};

/**
 * Read a cookie value by name (Result-returning version).
 */
export const readCookieValue = (name: string): Result<string, CookieError> => {
  if (typeof document === 'undefined') {
    const fallback = fallbackCookies.get(name);
    if (fallback !== undefined) {
      return ok(fallback);
    }
    return err({ kind: 'unavailable', message: 'Cookies unavailable.' });
  }

  try {
    const value = readCookie(name);
    if (value === null) {
      return err({ kind: 'missing', message: 'Cookie not found.' });
    }
    return ok(value);
  } catch (error) {
    return err({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
  }
};

export const writeCookie = (name: string, value: string, days?: number): void => {
  if (typeof document === 'undefined') {
    fallbackCookies.set(name, value);
    return;
  }
  let expires = '';
  if (days) {
    const date = new Date();
    date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
    expires = `; expires=${date.toUTCString()}`;
  }
  document.cookie = `${name}=${value || ''}${expires}; path=/; SameSite=Lax`;
};

/**
 * Write a cookie string safely, with a fallback setter for restricted environments.
 */
export const setCookieSafely = (value: string): Result<true, CookieError> => {
  const parsed = parseCookieAssignment(value);
  if (typeof document === 'undefined') {
    if (parsed) {
      if (isDeletionCookie(value)) {
        fallbackCookies.delete(parsed.name);
      } else {
        fallbackCookies.set(parsed.name, parsed.value);
      }
      return ok(true);
    }
    return err({ kind: 'failed', message: 'Failed to parse cookie assignment.' });
  }

  try {
    document.cookie = value;
    return ok(true);
  } catch {
    /* setter failed, try defining directly */
  }

  try {
    const proto: unknown = Object.getPrototypeOf(document);
    if (proto && typeof proto === 'object') {
      const descriptor = Object.getOwnPropertyDescriptor(proto, 'cookie');
      const setter = descriptor ? descriptor['set'] : undefined;
      if (setter) {
        setter.call(document, value);
        return ok(true);
      }
    }
  } catch {
    /* ignore and fall through to defineProperty */
  }

  try {
    Object.defineProperty(document, 'cookie', {
      get: () =>
        Array.from(fallbackCookies.entries())
          .map(([name, cookieValue]) => `${name}=${cookieValue}`)
          .join('; '),
      set: (cookieValue: string) => {
        const next = parseCookieAssignment(cookieValue);
        if (!next) {
          return;
        }
        if (isDeletionCookie(cookieValue)) {
          fallbackCookies.delete(next.name);
        } else {
          fallbackCookies.set(next.name, next.value);
        }
      },
      configurable: true,
    });
    if (parsed) {
      if (isDeletionCookie(value)) {
        fallbackCookies.delete(parsed.name);
      } else {
        fallbackCookies.set(parsed.name, parsed.value);
      }
    }
    return ok(true);
  } catch {
    return err({ kind: 'failed', message: 'Failed to set cookie.' });
  }
};

export const eraseCookie = (name: string): void => {
  if (typeof document === 'undefined') {
    fallbackCookies.delete(name);
    return;
  }
  document.cookie = `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT; SameSite=Lax`;
};
