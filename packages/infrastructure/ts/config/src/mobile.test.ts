import { describe, expect, it } from 'bun:test';

import { ensureMobileGoogleClientId, loadMobileEnv } from './mobile';

describe('config/mobile', () => {
  describe('loadMobileEnv', () => {
    it('loads defaults from an empty env object', () => {
      const env = loadMobileEnv({ env: {} });

      expect(env.nodeEnv).toBe('development');
      expect(env.api).toEqual({
        port: 3000,
        forceProd: false,
        baseUrl: undefined,
      });
      expect(env.sync).toEqual({
        baseUrl: undefined,
      });
      expect(env.voiceGateway).toEqual({
        baseUrl: undefined,
      });
      expect(env.flags.verboseStreaming).toBe(false);
      expect(env.sentry).toEqual({
        dsn: undefined,
        debug: false,
        disabled: false,
        environment: 'development',
        tracesSampleRate: 0,
        profilesSampleRate: 0,
      });
    });

    it('coerces boolean env flags from string values', () => {
      const env = loadMobileEnv({
        env: {
          EXPO_PUBLIC_FORCE_PROD_API: '1',
          EXPO_VERBOSE_STREAMING: 'TRUE',
          SENTRY_DEBUG: 'true',
          EXPO_PUBLIC_SENTRY_DISABLED: '1',
        },
      });

      expect(env.api.forceProd).toBe(true);
      expect(env.flags.verboseStreaming).toBe(true);
      expect(env.sentry.debug).toBe(true);
      expect(env.sentry.disabled).toBe(true);
    });

    it('uses precedence rules for sentry DSN and environment', () => {
      const env = loadMobileEnv({
        env: {
          EXPO_PUBLIC_SENTRY_DSN: 'https://sentry.example.com/expo',
          SENTRY_DSN: 'https://sentry.example.com/primary',
          NEXT_PUBLIC_SENTRY_DSN: 'https://sentry.example.com/secondary',
          SENTRY_ENVIRONMENT: ' ',
          EXPO_PUBLIC_SENTRY_ENVIRONMENT: 'staging',
          NEXT_PUBLIC_SENTRY_ENVIRONMENT: 'preview',
          VERCEL_ENV: 'production',
        },
      });

      expect(env.sentry.dsn).toBe('https://sentry.example.com/expo');
      expect(env.sentry.environment).toBe('staging');
    });

    it('coerces numeric sample rates and keeps precedence for first numeric candidate', () => {
      const env = loadMobileEnv({
        env: {
          SENTRY_TRACES_SAMPLE_RATE: '0.7',
          EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: '0.2',
          SENTRY_PROFILES_SAMPLE_RATE: 'not-a-number',
          EXPO_PUBLIC_SENTRY_PROFILES_SAMPLE_RATE: '0.4',
        },
      });

      expect(env.sentry.tracesSampleRate).toBe(0.7);
      expect(env.sentry.profilesSampleRate).toBe(0.4);
    });

    it('preserves explicit zero sample rates', () => {
      const env = loadMobileEnv({
        env: {
          SENTRY_TRACES_SAMPLE_RATE: '0',
          EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: '0.7',
          EXPO_PUBLIC_SENTRY_PROFILES_SAMPLE_RATE: '0.3',
          SENTRY_PROFILES_SAMPLE_RATE: '0',
        },
      });

      expect(env.sentry.tracesSampleRate).toBe(0);
      expect(env.sentry.profilesSampleRate).toBe(0);
    });

    it('coerces mobile e2e auth seed expiration values', () => {
      const env = loadMobileEnv({
        env: {
          EXPO_PUBLIC_ENABLE_E2E_AUTH_SEED: 'true',
          EXPO_PUBLIC_E2E_AUTH_EXPIRES_AT: ' 1710000000000 ',
        },
      });

      expect(env.e2eAuthSeed.enabled).toBe(true);
      expect(env.e2eAuthSeed.expiresAt).toBe(1710000000000);
    });

    it('ignores blank and non-numeric e2e auth seed expiration values', () => {
      const blank = loadMobileEnv({ env: { EXPO_PUBLIC_E2E_AUTH_EXPIRES_AT: '   ' } });
      const invalid = loadMobileEnv({ env: { EXPO_PUBLIC_E2E_AUTH_EXPIRES_AT: 'never' } });

      expect(blank.e2eAuthSeed.expiresAt).toBeUndefined();
      expect(invalid.e2eAuthSeed.expiresAt).toBeUndefined();
    });

    it('throws with field details when validation fails', () => {
      expect(() =>
        loadMobileEnv({
          env: {
            EXPO_PUBLIC_API_URL: 'not-a-url',
          },
        })
      ).toThrow('EXPO_PUBLIC_API_URL');
    });

    it('loads an explicit voice gateway URL', () => {
      const env = loadMobileEnv({
        env: {
          EXPO_PUBLIC_VOICE_GATEWAY_URL: 'https://voice.example.test',
        },
      });

      expect(env.voiceGateway.baseUrl).toBe('https://voice.example.test');
    });

    it('loads an explicit Sync service URL', () => {
      const env = loadMobileEnv({
        env: {
          EXPO_PUBLIC_SYNC_URL: 'https://sync.example.test',
        },
      });

      expect(env.sync.baseUrl).toBe('https://sync.example.test');
    });
  });

  describe('ensureMobileGoogleClientId', () => {
    it('throws when google client id is not configured', () => {
      const env = loadMobileEnv({
        env: {
          EXPO_PUBLIC_GOOGLE_CLIENT_ID: '   ',
        },
      });

      expect(() => ensureMobileGoogleClientId(env)).toThrow(
        'EXPO_PUBLIC_GOOGLE_CLIENT_ID must be set'
      );
    });

    it('returns configured google client id', () => {
      const env = loadMobileEnv({
        env: {
          EXPO_PUBLIC_GOOGLE_CLIENT_ID: 'google-client-id',
        },
      });

      expect(ensureMobileGoogleClientId(env)).toBe('google-client-id');
    });
  });
});
