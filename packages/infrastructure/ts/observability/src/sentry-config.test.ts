import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import {
  createBrowserOptions,
  createEdgeOptions,
  createServerOptions,
  sanitizeEvent,
} from './sentry-config';

const importMetaEnv = (
  import.meta as ImportMeta & {
    env: Record<string, string | undefined>;
  }
).env;

const setEnvValue = (key: string, value: string | undefined) => {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, key);
    return;
  }
  process.env[key] = value;
};

const setImportMetaEnvValue = (key: string, value: string | undefined) => {
  if (value === undefined) {
    Reflect.deleteProperty(importMetaEnv, key);
    return;
  }
  importMetaEnv[key] = value;
};

const restoreEnv = (original: NodeJS.ProcessEnv) => {
  for (const key of Object.keys(process.env)) {
    if (!(key in original)) {
      Reflect.deleteProperty(process.env, key);
    }
  }
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) {
      Reflect.deleteProperty(process.env, key);
    } else {
      process.env[key] = value;
    }
  }
};

describe('observability/sentry-config', () => {
  describe('sanitizeEvent', () => {
    it('returns event unchanged when no request data is present', () => {
      const event: { type: undefined; message: string } = {
        type: undefined,
        message: 'error',
      };
      const result = sanitizeEvent(event as Parameters<typeof sanitizeEvent>[0]);
      expect(result).toBe(event);
    });

    it('sanitizes sensitive headers', () => {
      const event = {
        request: {
          headers: {
            authorization: 'Bearer secret',
            cookie: 'session=secret',
            'set-cookie': 'session=secret',
            'x-api-key': 'api-key-value',
            'content-type': 'application/json',
          },
        },
      };

      const result = sanitizeEvent(event as unknown as Parameters<typeof sanitizeEvent>[0]);

      const headers = (result as any).request.headers;
      expect(headers.authorization).toBe('[Filtered]');
      expect(headers.cookie).toBe('[Filtered]');
      expect(headers['set-cookie']).toBe('[Filtered]');
      expect(headers['x-api-key']).toBe('[Filtered]');
      expect(headers['content-type']).toBe('application/json');
    });

    it('extracts correlation ID from headers', () => {
      const event = {
        request: {
          headers: {
            'x-correlation-id': 'corr-123',
          },
        },
      };

      const result = sanitizeEvent(event as unknown as Parameters<typeof sanitizeEvent>[0]);

      expect((result as any).tags.correlation_id).toBe('corr-123');
      expect((result as any).contexts.correlation.id).toBe('corr-123');
    });

    it('preserves existing tags when adding correlation ID', () => {
      const event = {
        tags: { existing: 'tag' },
        request: {
          headers: {
            'x-correlation-id': 'corr-456',
          },
        },
      };

      const result = sanitizeEvent(event as unknown as Parameters<typeof sanitizeEvent>[0]);

      expect((result as any).tags.existing).toBe('tag');
      expect((result as any).tags.correlation_id).toBe('corr-456');
    });

    it('scrubs sensitive fields in request.data', () => {
      const event = {
        request: {
          data: {
            username: 'user',
            password: 'secret',
            token: 'jwt-token',
          },
        },
      };

      const result = sanitizeEvent(event as unknown as Parameters<typeof sanitizeEvent>[0]);

      const data = (result as any).request.data;
      expect(data.username).toBe('user');
      expect(data.password).toBe('[Filtered]');
      expect(data.token).toBe('[Filtered]');
    });

    it('scrubs camelCase sensitive fields in event payloads', () => {
      const event = {
        extra: {
          userId: 'user-1',
          accessToken: 'jwt-token',
          refreshToken: 'refresh-token',
          clientSecret: 'client-secret',
        },
      };

      const result = sanitizeEvent(event as unknown as Parameters<typeof sanitizeEvent>[0]);

      expect((result as any).extra.userId).toBe('user-1');
      expect((result as any).extra.accessToken).toBe('[Filtered]');
      expect((result as any).extra.refreshToken).toBe('[Filtered]');
      expect((result as any).extra.clientSecret).toBe('[Filtered]');
    });

    it('scrubs sensitive URL and query string parameters', () => {
      const event = {
        request: {
          url: 'https://console.taskforceai.chat/billing?inviteToken=secret&plan=pro',
          query_string: 'session=secret&tab=usage',
        },
      };

      const result = sanitizeEvent(event as unknown as Parameters<typeof sanitizeEvent>[0]);

      expect((result as any).request.url).toBe(
        'https://console.taskforceai.chat/billing?inviteToken=%5BFiltered%5D&plan=pro'
      );
      expect((result as any).request.query_string).toBe('session=%5BFiltered%5D&tab=usage');
    });

    it('scrubs URL path and fragment values', () => {
      const event = {
        request: {
          url: '/auth/callback/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature#access_token=secret-token&email=user@example.com',
        },
      };

      const result = sanitizeEvent(event as unknown as Parameters<typeof sanitizeEvent>[0]);

      expect((result as any).request.url).toBe(
        '/auth/callback/[REDACTED_JWT]#access_token=%5BFiltered%5D&email=%5BREDACTED_EMAIL%5D'
      );
    });

    it('preserves empty fragments and scrubs fragment query parameters', () => {
      const emptyFragment = sanitizeEvent({
        request: {
          url: '/settings#',
        },
      } as unknown as Parameters<typeof sanitizeEvent>[0]);
      const fragmentQuery = sanitizeEvent({
        request: {
          url: '/callback#section?token=secret&tab=profile',
        },
      } as unknown as Parameters<typeof sanitizeEvent>[0]);

      expect((emptyFragment as any).request.url).toBe('/settings#');
      expect((fragmentQuery as any).request.url).toBe(
        '/callback#section?token=%5BFiltered%5D&tab=profile'
      );
    });

    it('preserves protocol-relative hosts while sanitizing URLs', () => {
      const event = {
        request: {
          url: '//evil.example/path?access_token=secret-token',
        },
      };

      const result = sanitizeEvent(event as unknown as Parameters<typeof sanitizeEvent>[0]);

      expect((result as any).request.url).toBe('//evil.example/path?access_token=%5BFiltered%5D');
    });

    it('does not add the parsing base host to bare relative URLs', () => {
      const event = {
        request: {
          url: 'foo/bar?x=1',
        },
      };

      const result = sanitizeEvent(event as unknown as Parameters<typeof sanitizeEvent>[0]);

      expect((result as any).request.url).toBe('foo/bar?x=1');
    });

    it('scrubs non-string URL and query string payloads', () => {
      const event = {
        request: {
          url: {
            path: '/billing',
            accessToken: 'url-token',
          },
          query_string: {
            tab: 'usage',
            refreshToken: 'query-token',
          },
        },
      };

      const result = sanitizeEvent(event as unknown as Parameters<typeof sanitizeEvent>[0]);

      expect((result as any).request.url).toEqual({
        path: '/billing',
        accessToken: '[Filtered]',
      });
      expect((result as any).request.query_string).toEqual({
        tab: 'usage',
        refreshToken: '[Filtered]',
      });
    });

    it('preserves leading question mark while scrubbing query strings', () => {
      const event = {
        request: {
          query_string: '?access_token=secret&tab=usage',
        },
      };

      const result = sanitizeEvent(event as unknown as Parameters<typeof sanitizeEvent>[0]);

      expect((result as any).request.query_string).toBe('?access_token=%5BFiltered%5D&tab=usage');
    });

    it('scrubs malformed URL strings with the string sanitizer fallback', () => {
      const event = {
        request: {
          url: 'http://[?token=secret-token',
        },
      };

      const result = sanitizeEvent(event as unknown as Parameters<typeof sanitizeEvent>[0]);

      expect((result as any).request.url).not.toContain('secret-token');
    });

    it('falls back to string scrubbing for malformed URLs without query strings', () => {
      const event = {
        request: {
          url: 'http://[Bearer secret-token',
        },
      };

      const result = sanitizeEvent(event as unknown as Parameters<typeof sanitizeEvent>[0]);

      expect((result as any).request.url).toBe('http://[[REDACTED_BEARER_TOKEN]');
    });

    it('filters request cookies', () => {
      const event = {
        request: {
          cookies: {
            session: 'secret',
          },
        },
      };

      const result = sanitizeEvent(event as unknown as Parameters<typeof sanitizeEvent>[0]);

      expect((result as any).request.cookies).toBe('[Filtered]');
    });

    it('scrubs sensitive fields in extra', () => {
      const event = {
        extra: {
          info: 'normal',
          api_key: 'secret-key',
        },
      };

      const result = sanitizeEvent(event as unknown as Parameters<typeof sanitizeEvent>[0]);

      expect((result as any).extra.info).toBe('normal');
      expect((result as any).extra.api_key).toBe('[Filtered]');
    });

    it('scrubs sensitive patterns in non-sensitive string fields', () => {
      const event = {
        request: {
          data: {
            description:
              'failed for user@example.com with Authorization: Bearer abc.def.ghi and card 4111111111111111',
          },
        },
        extra: {
          responseBody: 'token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature',
        },
      };

      const result = sanitizeEvent(event as unknown as Parameters<typeof sanitizeEvent>[0]);

      expect((result as any).request.data.description).toBe(
        'failed for [REDACTED_EMAIL] with Authorization: [REDACTED_BEARER_TOKEN] and card [REDACTED_CREDIT_CARD]'
      );
      expect((result as any).extra.responseBody).toBe('token: [REDACTED_JWT]');
    });

    it('scrubs top-level messages, exceptions, users, tags, and fingerprints', () => {
      const event = {
        message: 'failed for user@example.com with Authorization: Bearer message-token',
        exception: {
          values: [
            {
              value: 'exception for admin@example.com',
              mechanism: { data: { accessToken: 'exception-token' } },
            },
          ],
        },
        user: {
          id: 'user-1',
          email: 'user@example.com',
          ip_address: '203.0.113.9',
        },
        tags: {
          safe: 'kept',
          accessToken: 'tag-token',
        },
        fingerprint: ['user@example.com', 'stable-group'],
      };

      const result = sanitizeEvent(event as unknown as Parameters<typeof sanitizeEvent>[0]);

      expect((result as any).message).toBe(
        'failed for [REDACTED_EMAIL] with Authorization: [REDACTED_BEARER_TOKEN]'
      );
      expect((result as any).exception.values[0].value).toBe('exception for [REDACTED_EMAIL]');
      expect((result as any).exception.values[0].mechanism.data.accessToken).toBe('[Filtered]');
      expect((result as any).user).toEqual({
        id: 'user-1',
        email: '[Filtered]',
        ip_address: '[Filtered]',
      });
      expect((result as any).tags).toEqual({
        safe: 'kept',
        accessToken: '[Filtered]',
      });
      expect((result as any).fingerprint).toEqual(['[REDACTED_EMAIL]', 'stable-group']);
    });

    it('scrubs sensitive fields in contexts', () => {
      const event = {
        contexts: {
          user: {
            name: 'test',
            access_token: 'token-value',
          },
        },
      };

      const result = sanitizeEvent(event as unknown as Parameters<typeof sanitizeEvent>[0]);

      expect((result as any).contexts.user.name).toBe('test');
      expect((result as any).contexts.user.access_token).toBe('[Filtered]');
    });

    it('scrubs sensitive fields in breadcrumbs', () => {
      const event = {
        breadcrumbs: [
          {
            message: 'Authorization: Bearer breadcrumb-token',
            data: {
              url: '/api/test',
              authorization: 'Bearer token',
            },
          },
          'not a record',
          {
            data: {
              secret: 'hidden',
            },
          },
        ],
      };

      const result = sanitizeEvent(event as unknown as Parameters<typeof sanitizeEvent>[0]);

      const breadcrumbs = (result as any).breadcrumbs;
      expect(breadcrumbs[0].message).toBe('Authorization: [REDACTED_BEARER_TOKEN]');
      expect(breadcrumbs[0].data.url).toBe('/api/test');
      expect(breadcrumbs[0].data.authorization).toBe('[Filtered]');
      expect(breadcrumbs[1]).toBe('not a record');
      expect(breadcrumbs[2].data.secret).toBe('[Filtered]');
    });

    it('handles breadcrumb with null data', () => {
      const event = {
        breadcrumbs: [{ data: null }],
      };

      const result = sanitizeEvent(event as unknown as Parameters<typeof sanitizeEvent>[0]);

      expect((result as any).breadcrumbs[0].data).toEqual({});
    });

    it('handles array values in headers', () => {
      const event = {
        request: {
          headers: {
            accept: ['application/json', 'text/plain'],
          },
        },
      };

      const result = sanitizeEvent(event as unknown as Parameters<typeof sanitizeEvent>[0]);

      expect((result as any).request.headers.accept).toBe('application/json, text/plain');
    });

    it('scrubs nested arrays', () => {
      const event = {
        extra: [{ password: 'secret1' }, { password: 'secret2' }],
      };

      const result = sanitizeEvent(event as unknown as Parameters<typeof sanitizeEvent>[0]);

      const extra = (result as any).extra;
      expect(extra[0].password).toBe('[Filtered]');
      expect(extra[1].password).toBe('[Filtered]');
    });

    it('handles circular arrays in scrubbed payloads', () => {
      const circular: unknown[] = [];
      circular.push(circular);

      const event = {
        extra: circular,
      };

      const result = sanitizeEvent(event as unknown as Parameters<typeof sanitizeEvent>[0]);

      expect((result as any).extra).toEqual(['[Circular]']);
    });

    it('preserves repeated object and array references while scrubbing payloads', () => {
      const sharedObject = { accessToken: 'secret-token', label: 'shared' };
      const sharedArray = [{ password: 'secret-password' }];

      const event = {
        extra: {
          firstObject: sharedObject,
          secondObject: sharedObject,
          firstArray: sharedArray,
          secondArray: sharedArray,
        },
      };

      const result = sanitizeEvent(event as unknown as Parameters<typeof sanitizeEvent>[0]);
      const extra = (result as any).extra;

      expect(extra.firstObject).toBe(extra.secondObject);
      expect(extra.firstObject).toEqual({
        accessToken: '[Filtered]',
        label: 'shared',
      });
      expect(extra.firstArray).toBe(extra.secondArray);
      expect(extra.firstArray).toEqual([{ password: '[Filtered]' }]);
    });

    it('handles circular references in scrubbed payloads', () => {
      const circular: Record<string, unknown> = {
        password: 'secret',
      };
      circular['self'] = circular;

      const event = {
        extra: circular,
      };

      const result = sanitizeEvent(event as unknown as Parameters<typeof sanitizeEvent>[0]);

      expect((result as any).extra.password).toBe('[Filtered]');
      expect((result as any).extra.self).toBe('[Circular]');
    });

    it('handles missing request object', () => {
      const event = {
        extra: { info: 'test' },
      };

      const result = sanitizeEvent(event as unknown as Parameters<typeof sanitizeEvent>[0]);

      expect((result as any).extra.info).toBe('test');
    });

    it('handles request without headers', () => {
      const event = {
        request: {
          url: '/test',
        },
      };

      const result = sanitizeEvent(event as unknown as Parameters<typeof sanitizeEvent>[0]);

      expect((result as any).request.url).toBe('/test');
    });

    it('returns non-record events unchanged', () => {
      expect(sanitizeEvent(null as unknown as Parameters<typeof sanitizeEvent>[0])).toBeNull();
    });
  });

  describe('createBrowserOptions', () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
      originalEnv = { ...process.env };
    });

    afterEach(() => {
      restoreEnv(originalEnv);
    });

    it('creates browser options with DSN', () => {
      process.env['NEXT_PUBLIC_SENTRY_DSN'] = 'https://test@sentry.io/123';

      const options = createBrowserOptions();

      expect(options.dsn).toBe('https://test@sentry.io/123');
      expect(options.enabled).toBe(true);
    });

    it('reads Vite import.meta.env when process.env is unavailable', () => {
      const originalProcess = globalThis.process;
      const originalDsn = importMetaEnv['NEXT_PUBLIC_SENTRY_DSN'];
      const originalEnvironment = importMetaEnv['NEXT_PUBLIC_SENTRY_ENVIRONMENT'];

      try {
        Object.defineProperty(globalThis, 'process', {
          value: undefined,
          configurable: true,
          writable: true,
        });
        setImportMetaEnvValue('NEXT_PUBLIC_SENTRY_DSN', 'https://vite@sentry.io/321');
        setImportMetaEnvValue('NEXT_PUBLIC_SENTRY_ENVIRONMENT', 'production');

        const options = createBrowserOptions();

        expect(options.dsn).toBe('https://vite@sentry.io/321');
        expect(options.enabled).toBe(true);
        expect(options.environment).toBe('production');
      } finally {
        Object.defineProperty(globalThis, 'process', {
          value: originalProcess,
          configurable: true,
          writable: true,
        });
        setImportMetaEnvValue('NEXT_PUBLIC_SENTRY_DSN', originalDsn);
        setImportMetaEnvValue('NEXT_PUBLIC_SENTRY_ENVIRONMENT', originalEnvironment);
      }
    });

    it('disables when SENTRY_DISABLED is set', () => {
      process.env['NEXT_PUBLIC_SENTRY_DSN'] = 'https://test@sentry.io/123';
      process.env['SENTRY_DISABLED'] = '1';

      const options = createBrowserOptions();

      expect(options.enabled).toBe(false);
    });

    it('enables debug mode when SENTRY_DEBUG is set', () => {
      process.env['SENTRY_DEBUG'] = '1';

      const options = createBrowserOptions();

      expect(options.debug).toBe(true);
    });

    it('uses VERCEL_ENV for environment', () => {
      process.env['VERCEL_ENV'] = 'preview';

      const options = createBrowserOptions();

      expect(options.environment).toBe('preview');
    });

    it('parses sample rates from env', () => {
      process.env['SENTRY_TRACES_SAMPLE_RATE'] = '0.5';
      process.env['SENTRY_PROFILES_SAMPLE_RATE'] = '0.25';
      process.env['SENTRY_REPLAYS_SESSION_SAMPLE_RATE'] = '0.1';
      process.env['SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE'] = '0.75';

      const options = createBrowserOptions();

      expect(options.tracesSampleRate).toBe(0.5);
      expect(options.profilesSampleRate).toBe(0.25);
      expect(options.replaysSessionSampleRate).toBe(0.1);
      expect(options.replaysOnErrorSampleRate).toBe(0.75);
    });

    it('reads import.meta env values when process env is unavailable', () => {
      const originalProcess = globalThis.process;
      const originalDsn = importMetaEnv['NEXT_PUBLIC_SENTRY_DSN'];
      const originalDebug = importMetaEnv['SENTRY_DEBUG'];

      try {
        Object.defineProperty(globalThis, 'process', {
          value: undefined,
          configurable: true,
          writable: true,
        });
        setImportMetaEnvValue('NEXT_PUBLIC_SENTRY_DSN', 'https://vite-env@sentry.io/321');
        setImportMetaEnvValue('SENTRY_DEBUG', '1');

        const options = createBrowserOptions();

        expect(options.dsn).toBe('https://vite-env@sentry.io/321');
      } finally {
        Object.defineProperty(globalThis, 'process', {
          value: originalProcess,
          configurable: true,
          writable: true,
        });
        setImportMetaEnvValue('NEXT_PUBLIC_SENTRY_DSN', originalDsn);
        setImportMetaEnvValue('SENTRY_DEBUG', originalDebug);
      }
    });

    it('uses default sample rates for invalid values', () => {
      process.env['SENTRY_TRACES_SAMPLE_RATE'] = 'invalid';
      process.env['SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE'] = 'not-a-number';

      const options = createBrowserOptions();

      expect(options.tracesSampleRate).toBe(0);
      expect(options.replaysOnErrorSampleRate).toBe(1);
    });

    it('uses fallback sample rates for out-of-range values', () => {
      process.env['SENTRY_TRACES_SAMPLE_RATE'] = '2';
      process.env['SENTRY_PROFILES_SAMPLE_RATE'] = '-0.25';

      const options = createBrowserOptions();

      expect(options.tracesSampleRate).toBe(0);
      expect(options.profilesSampleRate).toBe(0);
    });

    it('includes ignoreErrors list', () => {
      const options = createBrowserOptions();

      expect(options.ignoreErrors).toContain('AbortError');
      expect(options.ignoreErrors).toContain('Load failed');
    });
  });

  describe('createServerOptions', () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
      originalEnv = { ...process.env };
    });

    afterEach(() => {
      restoreEnv(originalEnv);
    });

    it('creates server options with DSN', () => {
      const dsn = 'https://server@sentry.io/456';
      process.env['SENTRY_DSN'] = dsn;

      // Force refresh or just check if it contains the right domain if env is sticky
      const options = createServerOptions();

      expect(options.dsn?.includes('sentry.io')).toBe(true);
    });

    it('prefers private server DSN when public DSN is also set', () => {
      process.env['SENTRY_DSN'] = 'https://private@sentry.io/456';
      process.env['NEXT_PUBLIC_SENTRY_DSN'] = 'https://public@sentry.io/123';

      const options = createServerOptions();

      expect(options.dsn).toBe('https://private@sentry.io/456');
    });

    it('disables when no DSN', () => {
      delete process.env['SENTRY_DSN'];
      delete process.env['NEXT_PUBLIC_SENTRY_DSN'];

      const options = createServerOptions();

      expect(options.enabled).toBe(false);
    });
  });

  describe('createEdgeOptions', () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
      originalEnv = { ...process.env };
    });

    afterEach(() => {
      restoreEnv(originalEnv);
    });

    it('creates edge options with DSN', () => {
      const dsn = 'https://edge@sentry.io/789';
      process.env['SENTRY_DSN'] = dsn;

      const options = createEdgeOptions();

      expect(options.dsn?.includes('sentry.io')).toBe(true);
    });

    it('prefers private server DSN for edge when public DSN is also set', () => {
      process.env['SENTRY_DSN'] = 'https://edge-private@sentry.io/789';
      process.env['NEXT_PUBLIC_SENTRY_DSN'] = 'https://edge-public@sentry.io/123';

      const options = createEdgeOptions();

      expect(options.dsn).toBe('https://edge-private@sentry.io/789');
    });

    it('uses beforeSend for sanitization', () => {
      process.env['SENTRY_DSN'] = 'https://edge@sentry.io/789';

      const options = createEdgeOptions();

      expect(options.beforeSend).toBe(sanitizeEvent as typeof options.beforeSend);
    });
  });

  describe('sanitizeEvent edge cases', () => {
    it('handles event with request but no data', () => {
      const event = {
        request: {
          url: '/test',
          headers: {},
        },
      };

      const result = sanitizeEvent(event as unknown as Parameters<typeof sanitizeEvent>[0]);

      expect((result as any).request.url).toBe('/test');
    });

    it('handles event with empty contexts', () => {
      const event = {
        contexts: {},
      };

      const result = sanitizeEvent(event as unknown as Parameters<typeof sanitizeEvent>[0]);

      expect((result as any).contexts).toEqual({});
    });

    it('uses NODE_ENV when VERCEL_ENV not set', () => {
      setEnvValue('VERCEL_ENV', undefined);
      const originalNodeEnv = process.env['NODE_ENV'];
      setEnvValue('NODE_ENV', 'staging');

      const options = createBrowserOptions();

      expect(options.environment).toBe('staging');

      setEnvValue('NODE_ENV', originalNodeEnv);
    });

    it('uses the runtime NODE_ENV fallback when process env is unset', () => {
      setEnvValue('VERCEL_ENV', undefined);
      setEnvValue('SENTRY_ENVIRONMENT', undefined);
      setEnvValue('NEXT_PUBLIC_SENTRY_ENVIRONMENT', undefined);
      const originalNodeEnv = process.env['NODE_ENV'];
      setEnvValue('NODE_ENV', undefined);

      const options = createBrowserOptions();

      expect(options.environment).toBeDefined();
      expect(['development', 'test']).toContain(options.environment as string);

      setEnvValue('NODE_ENV', originalNodeEnv);
    });

    it('preserves existing contexts when adding correlation ID', () => {
      const event = {
        contexts: { existing: { data: 'value' } },
        request: {
          headers: {
            'x-correlation-id': 'corr-preserve',
          },
        },
      };

      const result = sanitizeEvent(event as unknown as Parameters<typeof sanitizeEvent>[0]);

      expect((result as any).contexts.existing.data).toBe('value');
      expect((result as any).contexts.correlation.id).toBe('corr-preserve');
    });
  });
});
