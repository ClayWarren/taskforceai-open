import { describe, expect, it, vi } from 'bun:test';

import { loadWebEnv } from './server';

describe('config/server', () => {
  const minimalValidEnv = {
    AI_GATEWAY_API_KEY: 'sk-mock',
  };

  describe('loadWebEnv', () => {
    it('loads defaults when env is minimal valid', () => {
      const { env } = loadWebEnv({
        env: minimalValidEnv,
        isTestEnv: true,
      });
      expect(env.NODE_ENV).toBe('development');
      expect(env.AUTH_SECRET).toBeDefined();
    });

    it('validates environment variables', () => {
      const { validateEnv } = loadWebEnv({
        env: minimalValidEnv,
        isTestEnv: true,
      });

      // All fields are optional or have defaults, so empty object validates
      const result = validateEnv({});
      expect(result.success).toBe(true);
    });

    it('passes validation with valid required fields', () => {
      const { validateEnv } = loadWebEnv({
        env: minimalValidEnv,
        isTestEnv: true,
      });

      const result = validateEnv(minimalValidEnv);
      expect(result.success).toBe(true);
    });

    it('throws in production when AUTH_SECRET is not explicitly set', () => {
      expect(() => {
        loadWebEnv({
          env: {
            NODE_ENV: 'production',
          },
          isTestEnv: false,
          isBuildTime: false,
          isClientSide: false,
        });
      }).toThrow(/AUTH_SECRET/);
    });

    it('throws in production when AUTH_SECRET is set to the development default', () => {
      expect(() => {
        loadWebEnv({
          env: {
            NODE_ENV: 'production',
            AUTH_SECRET: 'development-fallback-auth-secret-32-chars!',
          },
          isTestEnv: false,
          isBuildTime: false,
          isClientSide: false,
        });
      }).toThrow(/AUTH_SECRET/);
    });

    it('uses provided env source to validate production AUTH_SECRET', () => {
      // Prevent accidental reliance on ambient process.env when validating explicit sources.
      expect(() => {
        loadWebEnv({
          env: {
            NODE_ENV: 'production',
            AUTH_SECRET: 'x'.repeat(32),
          },
          isTestEnv: false,
          isBuildTime: false,
          isClientSide: false,
        });
      }).not.toThrow();
    });

    it('skips validation when explicitly requested', () => {
      expect(() => {
        loadWebEnv({
          env: { NODE_ENV: 'development' }, // Use development to allow skipping
          skipValidation: true,
        });
      }).not.toThrow();
    });

    it('transforms boolean strings', () => {
      const { env } = loadWebEnv({
        env: {
          ...minimalValidEnv,
          ENABLE_PAYMENTS: 'true',
          TASKFORCEAI_API_IN_MEMORY: '1',
          DISABLE_RATE_LIMITER_MEMORY_FALLBACK: 'yes',
        },
        isTestEnv: true,
      });

      expect(env.ENABLE_PAYMENTS).toBe(true);
      expect(env.TASKFORCEAI_API_IN_MEMORY).toBe(true);
      expect(env.DISABLE_RATE_LIMITER_MEMORY_FALLBACK).toBe(true);
    });

    it('rejects invalid boolean-like strings during validation', () => {
      const { validateEnv } = loadWebEnv({
        env: minimalValidEnv,
        isTestEnv: true,
      });

      const result = validateEnv({
        ...minimalValidEnv,
        ENABLE_PAYMENTS: 'definitely-not-bool',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.some((error) => error.includes('ENABLE_PAYMENTS'))).toBe(true);
      }
    });

    it('throws when invalid boolean-like strings are provided in runtime validation mode', () => {
      expect(() => {
        loadWebEnv({
          env: {
            NODE_ENV: 'development',
            ENABLE_PAYMENTS: 'invalid-value',
          },
          isTestEnv: false,
          isBuildTime: false,
          isClientSide: false,
        });
      }).toThrow(/ENABLE_PAYMENTS/);
    });

    it('handles OLLAMA conditional validation', () => {
      const { validateEnv } = loadWebEnv({ isTestEnv: true });

      // All fields have defaults, so empty object validates
      expect(validateEnv({}).success).toBe(true);

      // Still passes with Ollama enabled
      expect(
        validateEnv({
          OLLAMA_ENABLED: 'true',
          DATABASE_URL: 'postgres://localhost:5432/db',
        }).success
      ).toBe(true);
    });

    it('warns in development when validation fails with invalid URLs', () => {
      const warn = vi.fn();
      loadWebEnv({
        env: {
          NODE_ENV: 'development',
          DATABASE_URL: 'not-a-valid-url', // Invalid URL format
        },
        isTestEnv: false,
        isBuildTime: false,
        isClientSide: false,
        skipValidation: true, // Skip validation to get warning instead of throw
        logger: { warn },
      });

      expect(warn).toHaveBeenCalled();
    });

    it('keeps valid/default fields in skip-validation mode when one field is invalid', () => {
      const { env } = loadWebEnv({
        env: {
          NODE_ENV: 'development',
          DATABASE_URL: 'postgres://localhost:5432/db',
          ENABLE_PAYMENTS: 'true',
          VERCEL_AI_GATEWAY_URL: 'not-a-valid-url',
        },
        isTestEnv: false,
        isBuildTime: false,
        isClientSide: false,
        skipValidation: true,
      });

      expect(env.NODE_ENV).toBe('development');
      expect(env.DATABASE_URL).toBe('postgres://localhost:5432/db');
      expect(env.ENABLE_PAYMENTS).toBe(true);
      expect(env.CACHE_HASH_ALGORITHM).toBe('sha1');
    });

    it('validateEnv fails for production when AUTH_SECRET is missing', () => {
      const { validateEnv } = loadWebEnv({ isTestEnv: true });
      const result = validateEnv({
        NODE_ENV: 'production',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.some((error) => error.includes('AUTH_SECRET'))).toBe(true);
      }
    });
  });
});
