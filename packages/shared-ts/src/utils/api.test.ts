import { describe, expect, it } from 'bun:test';
import { readStatusCode, readErrorBody, getServerBaseUrl, readApiErrorMessage } from './api';

describe('readStatusCode', () => {
  it('returns null for non-objects', () => {
    expect(readStatusCode(null)).toBe(null);
    expect(readStatusCode(undefined)).toBe(null);
    expect(readStatusCode('error')).toBe(null);
    expect(readStatusCode(123)).toBe(null);
  });

  it('reads status property', () => {
    expect(readStatusCode({ status: 404 })).toBe(404);
    expect(readStatusCode({ status: 500 })).toBe(500);
  });

  it('reads statusCode property', () => {
    expect(readStatusCode({ statusCode: 400 })).toBe(400);
    expect(readStatusCode({ statusCode: 503 })).toBe(503);
  });

  it('reads status from nested response', () => {
    expect(readStatusCode({ response: { status: 401 } })).toBe(401);
    expect(readStatusCode({ response: { status: 403 } })).toBe(403);
  });

  it('prefers direct status over statusCode', () => {
    expect(readStatusCode({ status: 404, statusCode: 500 })).toBe(404);
  });

  it('prefers direct statusCode over nested response', () => {
    expect(readStatusCode({ statusCode: 400, response: { status: 500 } })).toBe(400);
  });

  it('returns null when no status found', () => {
    expect(readStatusCode({})).toBe(null);
    expect(readStatusCode({ message: 'error' })).toBe(null);
    expect(readStatusCode({ response: {} })).toBe(null);
  });
});

describe('readErrorBody', () => {
  it('returns null for non-objects', () => {
    expect(readErrorBody(null)).toBe(null);
    expect(readErrorBody(undefined)).toBe(null);
    expect(readErrorBody('error')).toBe(null);
  });

  it('returns body property', () => {
    expect(readErrorBody({ body: { error: 'test' } })).toEqual({ error: 'test' });
    expect(readErrorBody({ body: 'error message' })).toBe('error message');
  });

  it('returns null when no body property', () => {
    expect(readErrorBody({})).toBe(null);
    expect(readErrorBody({ message: 'error' })).toBe(null);
  });
});

describe('readApiErrorMessage', () => {
  it('prefers error over message', () => {
    expect(readApiErrorMessage({ error: 'invalid', message: 'fallback' })).toBe('invalid');
  });

  it('reads message when error is missing', () => {
    expect(readApiErrorMessage({ message: 'Something went wrong' })).toBe('Something went wrong');
  });

  it('ignores empty and non-string values', () => {
    expect(readApiErrorMessage({ error: '', message: 123 })).toBe(null);
    expect(readApiErrorMessage(null)).toBe(null);
  });
});

describe('getServerBaseUrl', () => {
  it('uses NEXT_PUBLIC_API_URL when set', () => {
    const env = { NEXT_PUBLIC_API_URL: 'https://api.example.com/' };
    expect(getServerBaseUrl(env)).toBe('https://api.example.com');
  });

  it('strips trailing slashes from NEXT_PUBLIC_API_URL', () => {
    const env = { NEXT_PUBLIC_API_URL: 'https://api.example.com///' };
    expect(getServerBaseUrl(env)).toBe('https://api.example.com');
  });

  it('uses VERCEL_URL when NEXT_PUBLIC_API_URL not set', () => {
    const env = { VERCEL_URL: 'my-app.vercel.app' };
    expect(getServerBaseUrl(env)).toBe('https://my-app.vercel.app');
  });

  it('prefers NEXT_PUBLIC_API_URL over VERCEL_URL', () => {
    const env = {
      NEXT_PUBLIC_API_URL: 'https://api.example.com',
      VERCEL_URL: 'my-app.vercel.app',
    };
    expect(getServerBaseUrl(env)).toBe('https://api.example.com');
  });

  it('uses window.location.origin in browser when no env override', () => {
    const savedWindow = globalThis.window;
    try {
      (globalThis as Record<string, unknown>)['window'] = {
        location: { origin: 'https://browser.example.com' },
      };
      expect(getServerBaseUrl()).toBe('https://browser.example.com');
    } finally {
      if (savedWindow) {
        globalThis.window = savedWindow;
      } else {
        delete (globalThis as Record<string, unknown>)['window'];
      }
    }
  });

  it('ignores window when explicit env passed', () => {
    const savedWindow = globalThis.window;
    try {
      (globalThis as Record<string, unknown>)['window'] = {
        location: { origin: 'https://browser.example.com' },
      };
      const env = { PORT: '4000' };
      expect(getServerBaseUrl(env)).toBe('http://localhost:4000');
    } finally {
      if (savedWindow) {
        globalThis.window = savedWindow;
      } else {
        delete (globalThis as Record<string, unknown>)['window'];
      }
    }
  });

  it('defaults to localhost with PORT', () => {
    const env = { PORT: '4000' };
    expect(getServerBaseUrl(env)).toBe('http://localhost:4000');
  });

  it('defaults to localhost:3000 without PORT', () => {
    expect(getServerBaseUrl({})).toBe('http://localhost:3000');
  });

  it('handles empty env object', () => {
    expect(getServerBaseUrl({})).toBe('http://localhost:3000');
  });
});
