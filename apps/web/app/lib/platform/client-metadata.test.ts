import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import {
  readClientMetadata,
  readPlatformLabel,
} from '@taskforceai/contracts/services/client-metadata';

// Store original globals
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

describe('client-metadata', () => {
  const createDateTimeFormatConstructor = (timeZone: string) => {
    // Create a function that can be called with or without `new`
    function MockDateTimeFormat() {
      return {
        format() {
          return '';
        },
        formatToParts() {
          return [];
        },
        formatRange() {
          return '';
        },
        formatRangeToParts() {
          return [];
        },
        resolvedOptions() {
          return {
            timeZone,
            locale: 'en-US',
            calendar: 'gregory',
            numberingSystem: 'latn',
          };
        },
      };
    }
    return Object.assign(MockDateTimeFormat, {
      supportedLocalesOf: () => [],
    });
  };
  beforeEach(() => {
    // Reset globals before each test
    setGlobalProperty('window', originalWindow);
    setGlobalProperty('navigator', originalNavigator);
    setGlobalProperty('Intl', originalIntl);
  });

  afterEach(() => {
    // Restore globals after each test
    setGlobalProperty('window', originalWindow);
    setGlobalProperty('navigator', originalNavigator);
    setGlobalProperty('Intl', originalIntl);
  });

  describe('readPlatformLabel', () => {
    it('returns platform when navigator.platform is available', () => {
      setGlobalProperty('navigator', { platform: 'MacIntel', language: 'en-US' });

      const result = readPlatformLabel();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('MacIntel');
      }
    });

    it('falls back to userAgent when platform is empty', () => {
      setGlobalProperty('navigator', {
        platform: '',
        userAgent: 'Mozilla/5.0',
        language: 'en-US',
      });

      const result = readPlatformLabel();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('Mozilla/5.0');
      }
    });

    it('returns unavailable error when navigator is undefined', () => {
      setGlobalProperty('navigator', undefined);

      const result = readPlatformLabel();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('unavailable');
      }
    });

    it('returns missing error when both platform and userAgent are empty', () => {
      setGlobalProperty('navigator', { platform: '', userAgent: '', language: 'en-US' });

      const result = readPlatformLabel();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('missing');
      }
    });
  });

  describe('readClientMetadata', () => {
    it('returns full metadata when all browser APIs are available', () => {
      setGlobalProperty('window', {});
      setGlobalProperty('navigator', { platform: 'MacIntel', language: 'en-US' });
      const mockIntl = {
        DateTimeFormat: createDateTimeFormatConstructor('America/New_York'),
      };
      setGlobalProperty('Intl', mockIntl);

      const result = readClientMetadata();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.locale).toBe('en-US');
        expect(result.value.timezone).toBe('America/New_York');
        expect(result.value.platform).toBe('MacIntel');
      }
    });

    it('returns unavailable error when window is undefined', () => {
      setGlobalProperty('window', undefined);

      const result = readClientMetadata();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('unavailable');
      }
    });

    it('returns metadata without locale when navigator.language is empty', () => {
      setGlobalProperty('window', {});
      setGlobalProperty('navigator', { platform: 'Win32', language: '' });
      const mockIntl = {
        DateTimeFormat: createDateTimeFormatConstructor('UTC'),
      };
      setGlobalProperty('Intl', mockIntl);

      const result = readClientMetadata();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.locale).toBeUndefined();
        expect(result.value.platform).toBe('Win32');
      }
    });

    it('returns metadata without timezone when Intl returns empty', () => {
      setGlobalProperty('window', {});
      setGlobalProperty('navigator', { platform: 'Linux', language: 'de-DE' });
      const mockIntl = {
        DateTimeFormat: createDateTimeFormatConstructor(''),
      };
      setGlobalProperty('Intl', mockIntl);

      const result = readClientMetadata();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.timezone).toBeUndefined();
        expect(result.value.locale).toBe('de-DE');
      }
    });

    it('returns metadata without platform when readPlatformLabel fails with missing', () => {
      setGlobalProperty('window', {});
      setGlobalProperty('navigator', { platform: '', userAgent: '', language: 'fr-FR' });
      const mockIntl = {
        DateTimeFormat: createDateTimeFormatConstructor('Europe/Paris'),
      };
      setGlobalProperty('Intl', mockIntl);

      const result = readClientMetadata();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.platform).toBeUndefined();
        expect(result.value.locale).toBe('fr-FR');
        expect(result.value.timezone).toBe('Europe/Paris');
      }
    });

    it('returns empty metadata object when all values are empty or missing', () => {
      setGlobalProperty('window', {});
      setGlobalProperty('navigator', { platform: '', userAgent: '', language: '' });
      const mockIntl = {
        DateTimeFormat: createDateTimeFormatConstructor(''),
      };
      setGlobalProperty('Intl', mockIntl);

      const result = readClientMetadata();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.locale).toBeUndefined();
        expect(result.value.timezone).toBeUndefined();
        expect(result.value.platform).toBeUndefined();
      }
    });
  });
});
