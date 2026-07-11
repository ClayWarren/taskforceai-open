import { afterEach, describe, expect, it } from 'bun:test';

import { getServerBaseUrl } from './server-base-url';

const globalScope = globalThis as typeof globalThis & {
  window?: { location: { origin: string } };
};
const originalWindow = globalScope.window;
const originalEnv = { ...process.env };

const restoreEnvironment = () => {
  for (const key of Object.keys(process.env)) {
    Reflect.deleteProperty(process.env, key);
  }
  Object.assign(process.env, originalEnv);
  if (originalWindow === undefined) {
    Reflect.deleteProperty(globalScope, 'window');
  } else {
    globalScope.window = originalWindow;
  }
};

describe('config/server-base-url', () => {
  afterEach(restoreEnvironment);

  it('prefers explicit API URLs and trims trailing slashes', () => {
    expect(getServerBaseUrl({ VITE_API_URL: 'https://api.taskforceai.test///' })).toBe(
      'https://api.taskforceai.test'
    );
    expect(getServerBaseUrl({ NEXT_PUBLIC_API_URL: 'https://public.taskforceai.test/' })).toBe(
      'https://public.taskforceai.test'
    );
  });

  it('falls back to Vercel, browser, and local origins', () => {
    expect(getServerBaseUrl({ VERCEL_URL: 'preview.taskforceai.test' })).toBe(
      'https://preview.taskforceai.test'
    );

    delete process.env['VITE_API_URL'];
    delete process.env['NEXT_PUBLIC_API_URL'];
    delete process.env['VERCEL_URL'];
    delete process.env['PORT'];
    globalScope.window = { location: { origin: 'https://browser.taskforceai.test' } } as any;
    expect(getServerBaseUrl()).toBe('https://browser.taskforceai.test');

    Reflect.deleteProperty(globalScope, 'window');
    expect(getServerBaseUrl({ PORT: '8080' })).toBe('http://localhost:8080');
    expect(getServerBaseUrl({})).toBe('http://localhost:3000');
  });
});
