import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import { eraseCookie, readCookie, readCookieValue, setCookieSafely, writeCookie } from './cookies';

const globalScope = globalThis as Record<string, unknown>;

const COOKIE_KEY = 'shared-ts-cookie-key';
const COOKIE_KEY_SECONDARY = 'shared-ts-cookie-secondary';

let previousDocument: unknown;

const restoreDocument = (): void => {
  if (previousDocument === undefined) {
    delete globalScope['document'];
    return;
  }
  globalScope['document'] = previousDocument;
};

const clearFallbackCookies = (): void => {
  const documentBeforeCleanup = globalScope['document'];
  delete globalScope['document'];
  eraseCookie(COOKIE_KEY);
  eraseCookie(COOKIE_KEY_SECONDARY);
  if (documentBeforeCleanup !== undefined) {
    globalScope['document'] = documentBeforeCleanup;
  }
};

describe('shared-ts/utils/cookies', () => {
  beforeEach(() => {
    previousDocument = globalScope['document'];
    delete globalScope['document'];
    clearFallbackCookies();
  });

  afterEach(() => {
    clearFallbackCookies();
    restoreDocument();
    vi.restoreAllMocks();
  });

  it('uses in-memory fallback storage when document is unavailable', () => {
    writeCookie(COOKIE_KEY, 'cookie-value');

    expect(readCookie(COOKIE_KEY)).toBe('cookie-value');

    eraseCookie(COOKIE_KEY);
    expect(readCookie(COOKIE_KEY)).toBeNull();
  });

  it('returns unavailable when reading a missing cookie without document', () => {
    const result = readCookieValue(COOKIE_KEY);

    expect(result).toEqual({
      ok: false,
      error: { kind: 'unavailable', message: 'Cookies unavailable.' },
    });
  });

  it('returns cookie value from fallback storage via Result API', () => {
    writeCookie(COOKIE_KEY, 'cookie-value');

    const result = readCookieValue(COOKIE_KEY);

    expect(result).toEqual({ ok: true, value: 'cookie-value' });
  });

  it('returns failed when setCookieSafely cannot parse assignment in fallback mode', () => {
    const result = setCookieSafely('invalid-cookie-assignment');

    expect(result).toEqual({
      ok: false,
      error: { kind: 'failed', message: 'Failed to parse cookie assignment.' },
    });
  });

  it('returns failed for cookie assignments without a name in fallback mode', () => {
    const result = setCookieSafely('; Path=/');

    expect(result).toEqual({
      ok: false,
      error: { kind: 'failed', message: 'Failed to parse cookie assignment.' },
    });
  });

  it('writes and deletes cookies via setCookieSafely in fallback mode', () => {
    const writeResult = setCookieSafely(`${COOKIE_KEY}=abc123; Path=/`);
    expect(writeResult).toEqual({ ok: true, value: true });
    expect(readCookie(COOKIE_KEY)).toBe('abc123');

    const deleteResult = setCookieSafely(
      `${COOKIE_KEY}=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/`
    );
    expect(deleteResult).toEqual({ ok: true, value: true });
    expect(readCookie(COOKIE_KEY)).toBeNull();
  });

  it('rejects blank fallback cookie assignments', () => {
    const result = setCookieSafely('   ');

    expect(result).toEqual({
      ok: false,
      error: { kind: 'failed', message: 'Failed to parse cookie assignment.' },
    });
  });

  it('reads cookie values from browser cookie string with leading spaces', () => {
    globalScope['document'] = {
      cookie: `${COOKIE_KEY_SECONDARY}=first; ${COOKIE_KEY}=from-browser`,
    };

    expect(readCookie(COOKIE_KEY)).toBe('from-browser');
    expect(readCookie('not-present')).toBeNull();
  });

  it('writes browser cookies with path, SameSite, and optional expiration', () => {
    const writes: string[] = [];
    globalScope['document'] = {};
    Object.defineProperty(globalScope['document'], 'cookie', {
      get: () => writes.join('; '),
      set: (value: string) => {
        writes.push(value);
      },
      configurable: true,
    });

    writeCookie(COOKIE_KEY, 'from-browser', 7);
    writeCookie(COOKIE_KEY_SECONDARY, '');

    expect(writes[0]).toMatch(
      /^shared-ts-cookie-key=from-browser; expires=.+ GMT; path=\/; SameSite=Lax$/
    );
    expect(writes[1]).toBe(`${COOKIE_KEY_SECONDARY}=; path=/; SameSite=Lax`);
  });

  it('erases browser cookies through an expired assignment', () => {
    const writes: string[] = [];
    globalScope['document'] = {};
    Object.defineProperty(globalScope['document'], 'cookie', {
      get: () => '',
      set: (value: string) => {
        writes.push(value);
      },
      configurable: true,
    });

    eraseCookie(COOKIE_KEY);

    expect(writes).toEqual([
      `${COOKIE_KEY}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT; SameSite=Lax`,
    ]);
  });

  it('falls back to prototype cookie setter when direct assignment throws', () => {
    const prototypeSetter = vi.fn();
    const documentPrototype = {};
    Object.defineProperty(documentPrototype, 'cookie', {
      set: prototypeSetter,
      configurable: true,
    });

    const documentMock = Object.create(documentPrototype);
    Object.defineProperty(documentMock, 'cookie', {
      get: () => '',
      set: () => {
        throw new Error('direct cookie setter blocked');
      },
      configurable: true,
    });
    globalScope['document'] = documentMock;

    const result = setCookieSafely(`${COOKIE_KEY}=from-prototype; Path=/`);

    expect(prototypeSetter).toHaveBeenCalledWith(`${COOKIE_KEY}=from-prototype; Path=/`);
    expect(result).toEqual({ ok: true, value: true });
  });

  it('defines a fallback cookie store when browser cookie setters are blocked', () => {
    const documentMock = {};
    Object.defineProperty(documentMock, 'cookie', {
      get: () => {
        throw new Error('cookie getter blocked');
      },
      set: () => {
        throw new Error('cookie setter blocked');
      },
      configurable: true,
    });
    globalScope['document'] = documentMock;

    const writeResult = setCookieSafely(`${COOKIE_KEY}=fallback-value; Path=/`);
    const readResult = readCookieValue(COOKIE_KEY);
    const deleteResult = setCookieSafely(`${COOKIE_KEY}=; Max-Age=0; Path=/`);
    const rewriteResult = setCookieSafely(`${COOKIE_KEY_SECONDARY}=next-value; Path=/`);

    expect(writeResult).toEqual({ ok: true, value: true });
    expect(readResult).toEqual({ ok: true, value: 'fallback-value' });
    expect(deleteResult).toEqual({ ok: true, value: true });
    expect(rewriteResult).toEqual({ ok: true, value: true });
    expect(readCookie(COOKIE_KEY_SECONDARY)).toBe('next-value');
    expect(readCookie(COOKIE_KEY)).toBeNull();
  });

  it('returns failed when blocked browser cookies cannot be redefined', () => {
    const documentMock = {};
    Object.defineProperty(documentMock, 'cookie', {
      get: () => '',
      set: () => {
        throw new Error('cookie setter blocked');
      },
      configurable: false,
    });
    globalScope['document'] = documentMock;

    const result = setCookieSafely(`${COOKIE_KEY}=blocked; Path=/`);

    expect(result).toEqual({
      ok: false,
      error: { kind: 'failed', message: 'Failed to set cookie.' },
    });
  });

  it('reports failed cookie reads when the browser cookie getter throws', () => {
    globalScope['document'] = {};
    Object.defineProperty(globalScope['document'], 'cookie', {
      get: () => {
        throw new Error('cookie read blocked');
      },
      set: () => undefined,
      configurable: true,
    });

    const result = readCookieValue(COOKIE_KEY);

    expect(result).toEqual({
      ok: false,
      error: { kind: 'failed', message: 'cookie read blocked' },
    });
  });

  it('returns missing when cookie is absent in browser mode', () => {
    globalScope['document'] = {
      cookie: `${COOKIE_KEY_SECONDARY}=value`,
    };

    const result = readCookieValue(COOKIE_KEY);

    expect(result).toEqual({
      ok: false,
      error: { kind: 'missing', message: 'Cookie not found.' },
    });
  });
});
