import { afterEach, describe, expect, test } from 'bun:test';

import { assertStatusJsonUrl, resolveStatusJsonRouteDestination } from './vercel-build';

const STATUS_JSON_ENV = 'VITE_STATUS_JSON_URL';
const API_STATUS_URL = 'https://api.taskforceai.chat/api/v1/status';

const originalEnv = {
  statusJsonUrl: process.env[STATUS_JSON_ENV],
  vercel: process.env['VERCEL'],
  vercelEnv: process.env['VERCEL_ENV'],
};

const clearBuildEnv = () => {
  delete process.env[STATUS_JSON_ENV];
  delete process.env['VERCEL'];
  delete process.env['VERCEL_ENV'];
};

afterEach(() => {
  if (originalEnv.statusJsonUrl === undefined) delete process.env[STATUS_JSON_ENV];
  else process.env[STATUS_JSON_ENV] = originalEnv.statusJsonUrl;

  if (originalEnv.vercel === undefined) delete process.env['VERCEL'];
  else process.env['VERCEL'] = originalEnv.vercel;

  if (originalEnv.vercelEnv === undefined) delete process.env['VERCEL_ENV'];
  else process.env['VERCEL_ENV'] = originalEnv.vercelEnv;
});

describe('status Vercel build configuration', () => {
  test('uses the configured Blob status JSON URL for /status.json', () => {
    clearBuildEnv();
    process.env[STATUS_JSON_ENV] =
      'https://status-store.public.blob.vercel-storage.com/status/status.json';

    expect(resolveStatusJsonRouteDestination()).toBe(
      'https://status-store.public.blob.vercel-storage.com/status/status.json'
    );
  });

  test('falls back to the live API route outside Vercel builds', () => {
    clearBuildEnv();

    expect(resolveStatusJsonRouteDestination()).toBe(API_STATUS_URL);
    expect(() => assertStatusJsonUrl()).not.toThrow();
  });

  test('requires a Blob-backed HTTPS status URL in Vercel builds', () => {
    clearBuildEnv();
    process.env['VERCEL'] = '1';

    expect(() => assertStatusJsonUrl()).toThrow(`${STATUS_JSON_ENV} is required`);

    process.env[STATUS_JSON_ENV] = API_STATUS_URL;
    expect(() => assertStatusJsonUrl()).toThrow('must point at the Blob-backed status.json');

    process.env[STATUS_JSON_ENV] = 'http://status-store.public.blob.vercel-storage.com/status.json';
    expect(() => assertStatusJsonUrl()).toThrow('must use HTTPS');

    process.env[STATUS_JSON_ENV] = 'https://status.example.com/status.json';
    expect(() => assertStatusJsonUrl()).toThrow('must use a Blob host allowed');

    process.env[STATUS_JSON_ENV] =
      'https://status-store.public.blob.vercel-storage.com/status.json';
    expect(() => assertStatusJsonUrl()).not.toThrow();
  });
});
