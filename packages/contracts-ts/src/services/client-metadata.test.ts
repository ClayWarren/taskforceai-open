import { afterEach, describe, expect, it } from 'bun:test';

import { readClientMetadata, readPlatformLabel } from './client-metadata';

const originalWindow = globalThis.window;
const originalNavigator = globalThis.navigator;
const originalIntl = globalThis.Intl;

const setGlobalProperty = (key: 'window' | 'navigator' | 'Intl', value: unknown) => {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value,
  });
};

const createDateTimeFormatConstructor = (timeZone: string) => {
  function MockDateTimeFormat() {
    return {
      format() {
        return '';
      },
      formatToParts() {
        return [];
      },
      resolvedOptions() {
        return {
          calendar: 'gregory',
          locale: 'en-US',
          numberingSystem: 'latn',
          timeZone,
        };
      },
    };
  }

  return Object.assign(MockDateTimeFormat, {
    supportedLocalesOf: () => [],
  });
};

describe('client metadata helpers', () => {
  afterEach(() => {
    setGlobalProperty('window', originalWindow);
    setGlobalProperty('navigator', originalNavigator);
    setGlobalProperty('Intl', originalIntl);
  });

  it('reads navigator platform with a user agent fallback', () => {
    setGlobalProperty('navigator', { platform: 'MacIntel', userAgent: 'Mozilla/5.0' });
    expect(readPlatformLabel()).toEqual({ ok: true, value: 'MacIntel' });

    setGlobalProperty('navigator', { platform: '', userAgent: 'Mozilla/5.0' });
    expect(readPlatformLabel()).toEqual({ ok: true, value: 'Mozilla/5.0' });
  });

  it('returns platform errors when navigator data is unavailable', () => {
    setGlobalProperty('navigator', undefined);
    expect(readPlatformLabel()).toEqual({
      ok: false,
      error: { kind: 'unavailable', message: 'Navigator unavailable.' },
    });

    setGlobalProperty('navigator', { platform: '', userAgent: '' });
    expect(readPlatformLabel()).toEqual({
      ok: false,
      error: { kind: 'missing', message: 'Platform unavailable.' },
    });
  });

  it('reads locale timezone and platform metadata on the client', () => {
    setGlobalProperty('window', {});
    setGlobalProperty('navigator', { language: 'en-US', platform: 'MacIntel' });
    setGlobalProperty('Intl', {
      DateTimeFormat: createDateTimeFormatConstructor('America/Chicago'),
    });

    const result = readClientMetadata();

    expect(result).toEqual({
      ok: true,
      value: {
        locale: 'en-US',
        platform: 'MacIntel',
        timezone: 'America/Chicago',
      },
    });
  });

  it('omits missing optional metadata values', () => {
    setGlobalProperty('window', {});
    setGlobalProperty('navigator', { language: '', platform: '', userAgent: '' });
    setGlobalProperty('Intl', {
      DateTimeFormat: createDateTimeFormatConstructor(''),
    });

    expect(readClientMetadata()).toEqual({ ok: true, value: {} });
  });

  it('returns an unavailable error without a client window', () => {
    setGlobalProperty('window', undefined);

    expect(readClientMetadata()).toEqual({
      ok: false,
      error: { kind: 'unavailable', message: 'Client metadata unavailable.' },
    });
  });
});
