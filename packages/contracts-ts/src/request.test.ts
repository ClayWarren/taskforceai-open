import { beforeEach, describe, expect, it, vi } from 'bun:test';

import { ApiClientError, createRequestContext } from './request';
import {
  applyAuthorizationHeader,
  isJsonResponse,
  isRecord,
  normalizeBaseUrl,
  parseErrorPayload,
  parseOptional,
  parseSuccessPayload,
  resolveBearerToken,
} from './request.utils';
import { err, ok } from './utils/result';
import type { AuthTokenPayload } from './request.types';

const jsonResponse = (body: unknown = {}, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

describe('contracts-ts/request', () => {
  const buildFetchMock = () =>
    Object.assign(vi.fn(), {
      preconnect: () => {},
    });
  const buildCtx = (
    response: Response = jsonResponse(),
    options: Omit<NonNullable<Parameters<typeof createRequestContext>[0]>, 'fetchImpl'> = {}
  ) => {
    const fetchMock = buildFetchMock().mockResolvedValue(response);
    return {
      ctx: createRequestContext({ fetchImpl: fetchMock, ...options }),
      fetchMock,
    };
  };
  const retryPolicy = {
    apiClient: {
      timeoutMs: 2000,
      circuitBreaker: { failureThreshold: 5, recoveryTimeMs: 30000 },
      retry: { attempts: 2, baseDelayMs: 1, jitterMs: 0 },
    },
  };

  describe('createRequestContext', () => {
    it('throws when no fetch implementation is available', () => {
      const originalFetch = globalThis.fetch;
      // @ts-expect-error - simulating missing fetch
      globalThis.fetch = undefined;

      try {
        expect(() => createRequestContext()).toThrow('No fetch implementation provided.');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('uses circuitBreakerFactory when provided', async () => {
      const mockExecute = vi.fn((fn) => fn());
      const mockCircuitBreakerFactory = vi.fn().mockReturnValue({
        execute: mockExecute,
      });

      const { ctx } = buildCtx(jsonResponse({ data: 'test' }), {
        baseUrl: 'https://api.example.com',
        circuitBreakerFactory: mockCircuitBreakerFactory,
      });

      await ctx.request('/test');

      expect(mockCircuitBreakerFactory).toHaveBeenCalledWith('api-client-https://api.example.com', {
        failureThreshold: 5,
        recoveryTimeMs: 30000,
        labels: { baseUrl: 'https://api.example.com' },
      });
      expect(mockExecute).toHaveBeenCalled();
    });

    it('makes successful request with JSON response', async () => {
      const { ctx } = buildCtx(jsonResponse({ data: 'test' }), {
        baseUrl: 'https://api.example.com',
      });

      const result = await ctx.request<{ data: string }>('/test');

      expect(result).toEqual({ data: 'test' });
    });

    it('handles 204 response with no content', async () => {
      const { ctx } = buildCtx(
        new Response(null, {
          status: 204,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const result = await ctx.request('/test');

      expect(result).toBeUndefined();
    });

    it('handles parseJson false option', async () => {
      const { ctx } = buildCtx(
        new Response('plain text response', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        })
      );

      const result = await ctx.request<string>('/test', {}, { parseJson: false });

      expect(result).toBe('plain text response');
    });

    it('throws ApiClientError on non-ok response', async () => {
      const { ctx } = buildCtx(
        jsonResponse({ detail: 'Not found' }, { status: 404, statusText: 'Not Found' })
      );

      await expect(ctx.request('/test')).rejects.toThrow(ApiClientError);
    });

    it('uses Huma nested validation error messages for ApiClientError text', async () => {
      const fetchMock = buildFetchMock().mockResolvedValue(
        new Response(
          JSON.stringify({
            title: 'Unauthorized',
            status: 401,
            detail: 'validation failed',
            errors: [{ message: 'Unauthorized' }],
          }),
          {
            status: 401,
            statusText: 'Unauthorized',
            headers: { 'Content-Type': 'application/problem+json' },
          }
        )
      );

      const ctx = createRequestContext({ fetchImpl: fetchMock });

      await expect(ctx.request('/test')).rejects.toThrow('Unauthorized');
    });

    it('includes credentials by default', async () => {
      const { ctx, fetchMock } = buildCtx();

      await ctx.request('/test');

      expect(fetchMock).toHaveBeenCalledWith(
        '/test',
        expect.objectContaining({ credentials: 'include' })
      );
    });

    it('uses provided getToken function', async () => {
      const getToken = vi.fn().mockReturnValue(ok('my-token'));
      const { ctx, fetchMock } = buildCtx(jsonResponse(), { getToken });

      await ctx.request('/test');

      expect(getToken).toHaveBeenCalled();
      const [, init] = fetchMock.mock.calls[0]!;
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer my-token');
    });

    it('respects explicit Authorization header when token provider throws', async () => {
      const getToken = vi.fn(() => {
        throw new Error('token provider offline');
      });
      const { ctx, fetchMock } = buildCtx(jsonResponse({ ok: true }), { getToken });

      const response = await ctx.request<{ ok: boolean }>('/test', {
        headers: { Authorization: 'Bearer explicit-token' },
      });
      expect(response).toEqual({ ok: true });

      expect(getToken).not.toHaveBeenCalled();
      const [, init] = fetchMock.mock.calls[0]!;
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer explicit-token');
    });

    it('handles async getToken function', async () => {
      const getToken = vi.fn().mockResolvedValue(ok('async-token'));
      const { ctx, fetchMock } = buildCtx(jsonResponse(), { getToken });

      await ctx.request('/test');

      const [, init] = fetchMock.mock.calls[0]!;
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer async-token');
    });

    it('applies bearer token from structured token payload', async () => {
      const getToken = vi.fn().mockResolvedValue(ok({ access_token: 'token-from-object' }));
      const { ctx, fetchMock } = buildCtx(jsonResponse(), { getToken });

      await ctx.request('/test');

      const [, init] = fetchMock.mock.calls[0]!;
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer token-from-object');
    });

    it('buildJsonHeaders sets Content-Type if not present', () => {
      const { ctx } = buildCtx();

      const headers = ctx.buildJsonHeaders();

      expect(headers.get('Content-Type')).toBe('application/json');
    });

    it('buildJsonHeaders preserves existing Content-Type', () => {
      const { ctx } = buildCtx();

      const headers = ctx.buildJsonHeaders({ 'Content-Type': 'text/plain' });

      expect(headers.get('Content-Type')).toBe('text/plain');
    });

    it('exposes parseOptional', () => {
      const { ctx } = buildCtx();

      expect(ctx.parseOptional).toBe(parseOptional);
    });

    it('exposes ApiClientError', () => {
      const { ctx } = buildCtx();

      expect(ctx.ApiClientError).toBe(ApiClientError);
    });

    it('uses relative base url label when no baseUrl provided', async () => {
      const mockExecute = vi.fn((fn) => fn());
      const mockCircuitBreakerFactory = vi.fn().mockReturnValue({
        execute: mockExecute,
      });

      const { ctx } = buildCtx(jsonResponse(), {
        circuitBreakerFactory: mockCircuitBreakerFactory,
      });

      await ctx.request('/test');

      expect(mockCircuitBreakerFactory).toHaveBeenCalledWith(
        'api-client-relative',
        expect.any(Object)
      );
    });

    it('handles non-JSON error response body', async () => {
      const { ctx } = buildCtx({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: () => Promise.resolve('Plain text error'),
      } as Response);

      try {
        await ctx.request('/test');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiClientError);
        expect((error as ApiClientError).message).toBe('Bad Request');
      }
    });

    it('increments error metric when request throws', async () => {
      const fetchMock = buildFetchMock().mockRejectedValue(new Error('Network error'));
      const mockMetrics = {
        incrementCounter: vi.fn(),
        startTimer: vi.fn(() => vi.fn()),
      };

      const ctx = createRequestContext({
        fetchImpl: fetchMock,
        metrics: mockMetrics,
      });

      await expect(ctx.request('/test')).rejects.toThrow('Network error');

      expect(mockMetrics.incrementCounter).toHaveBeenCalledWith(
        'api.client.request.error',
        expect.objectContaining({ error: 'Error' })
      );
    });

    it('retries retryable HTTP failures and succeeds', async () => {
      const fetchMock = buildFetchMock()
        .mockResolvedValueOnce(
          new Response('retry me', {
            status: 503,
            statusText: 'Service Unavailable',
          })
        )
        .mockResolvedValueOnce(jsonResponse({ ok: true }));

      const ctx = createRequestContext({
        fetchImpl: fetchMock,
        resiliencePolicy: retryPolicy,
      });

      const result = await ctx.request<{ ok: boolean }>('/test');

      expect(result).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('does not retry non-idempotent POST requests', async () => {
      const fetchMock = buildFetchMock()
        .mockResolvedValueOnce(
          new Response('retry me', {
            status: 503,
            statusText: 'Service Unavailable',
          })
        )
        .mockResolvedValueOnce(jsonResponse({ ok: true }));

      const ctx = createRequestContext({
        fetchImpl: fetchMock,
        resiliencePolicy: retryPolicy,
      });

      expect(
        ctx.request('/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ foo: 'bar' }),
        })
      ).rejects.toMatchObject({ status: 503 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('retries POST requests when Idempotency-Key header is present', async () => {
      const fetchMock = buildFetchMock()
        .mockResolvedValueOnce(
          new Response('retry me', {
            status: 503,
            statusText: 'Service Unavailable',
          })
        )
        .mockResolvedValueOnce(jsonResponse({ ok: true }));

      const ctx = createRequestContext({
        fetchImpl: fetchMock,
        resiliencePolicy: retryPolicy,
      });

      const result = await ctx.request<{ ok: boolean }>(
        '/test',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': 'idem-1',
          },
          body: JSON.stringify({ foo: 'bar' }),
        },
        { parseJson: true }
      );

      expect(result).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('aborts timed out requests', async () => {
      const fetchMock = buildFetchMock().mockImplementation(
        async (_url: string, init?: RequestInit) =>
          await new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted', 'AbortError'));
            });
          })
      );

      const ctx = createRequestContext({
        fetchImpl: fetchMock,
        resiliencePolicy: {
          apiClient: {
            timeoutMs: 5,
            circuitBreaker: { failureThreshold: 5, recoveryTimeMs: 30000 },
            retry: { attempts: 1, baseDelayMs: 1, jitterMs: 0 },
          },
        },
      });

      // eslint-disable-next-line typescript-eslint/await-thenable -- bun:test .rejects.toThrow() returns a Promise at runtime
      await expect(ctx.request('/test')).rejects.toThrow();
    });

    it('allows a per-request timeout override', async () => {
      const fetchMock = buildFetchMock().mockImplementation(
        async (_url: string, init?: RequestInit) =>
          await new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted', 'AbortError'));
            });
          })
      );

      const ctx = createRequestContext({
        fetchImpl: fetchMock,
        resiliencePolicy: {
          apiClient: {
            timeoutMs: 50_000,
            circuitBreaker: { failureThreshold: 5, recoveryTimeMs: 30000 },
            retry: { attempts: 1, baseDelayMs: 1, jitterMs: 0 },
          },
        },
      });

      // eslint-disable-next-line typescript-eslint/await-thenable -- bun:test .rejects.toThrow() returns a Promise at runtime
      await expect(ctx.request('/test', {}, { timeoutMs: 5 })).rejects.toThrow();
    });

    it('does not retry when request is externally aborted', async () => {
      const fetchMock = buildFetchMock().mockImplementation(
        async (_url: string, init?: RequestInit) => {
          if (init?.signal?.aborted) {
            throw new DOMException('The operation was aborted', 'AbortError');
          }
          return await new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted', 'AbortError'));
            });
          });
        }
      );

      const ctx = createRequestContext({
        fetchImpl: fetchMock,
        resiliencePolicy: {
          apiClient: {
            timeoutMs: 50,
            circuitBreaker: { failureThreshold: 5, recoveryTimeMs: 30000 },
            retry: { attempts: 3, baseDelayMs: 1, jitterMs: 0 },
          },
        },
      });

      const controller = new AbortController();
      controller.abort();

      let requestFailed = false;
      try {
        await ctx.request('/test', { signal: controller.signal });
      } catch {
        requestFailed = true;
      }
      expect(requestFailed).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not count externally aborted requests as timeout failures', async () => {
      const incrementCounter = vi.fn();
      const startTimer = vi.fn(() => () => {});

      const fetchMock = buildFetchMock().mockImplementation(
        async (_url: string, init?: RequestInit) => {
          if (init?.signal?.aborted) {
            throw new DOMException('The operation was aborted', 'AbortError');
          }
          return await new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted', 'AbortError'));
            });
          });
        }
      );

      const ctx = createRequestContext({
        fetchImpl: fetchMock,
        metrics: {
          incrementCounter,
          startTimer,
        },
        resiliencePolicy: {
          apiClient: {
            timeoutMs: 50,
            circuitBreaker: { failureThreshold: 5, recoveryTimeMs: 30000 },
            retry: { attempts: 3, baseDelayMs: 1, jitterMs: 0 },
          },
        },
      });

      const controller = new AbortController();
      controller.abort();

      let requestFailed = false;
      try {
        await ctx.request('/test', { signal: controller.signal });
      } catch {
        requestFailed = true;
      }
      expect(requestFailed).toBe(true);

      expect(incrementCounter).toHaveBeenCalledWith('api.client.request.aborted', {
        baseUrl: 'relative',
        method: 'GET',
        path: '/test',
      });
      expect(incrementCounter).not.toHaveBeenCalledWith(
        'taskforceai.slo.request.timeout',
        expect.anything()
      );
      expect(incrementCounter).not.toHaveBeenCalledWith(
        'taskforceai.slo.request.failure',
        expect.anything()
      );
    });
  });
});

describe('contracts-ts/request.utils', () => {
  describe('isJsonResponse', () => {
    const cases: Array<[string, HeadersInit | undefined, boolean]> = [
      ['application/json content type', { 'Content-Type': 'application/json' }, true],
      [
        'application/json with charset',
        { 'Content-Type': 'application/json; charset=utf-8' },
        true,
      ],
      ['non-JSON content type', { 'Content-Type': 'text/plain' }, false],
      ['no content-type header', undefined, false],
    ];

    for (const [name, headers, expected] of cases) {
      it(`returns ${expected} for ${name}`, () => {
        expect(isJsonResponse(new Response(null, { headers }))).toBe(expected);
      });
    }
  });

  describe('normalizeBaseUrl', () => {
    const cases: Array<[string, string | undefined, string]> = [
      ['undefined', undefined, ''],
      ['empty string', '', ''],
      ['trailing slash', 'https://api.example.com/', 'https://api.example.com'],
      ['URL without trailing slash', 'https://api.example.com', 'https://api.example.com'],
    ];

    for (const [name, input, expected] of cases) {
      it(`normalizes ${name}`, () => {
        expect(normalizeBaseUrl(input)).toBe(expected);
      });
    }
  });

  describe('isRecord', () => {
    const cases: Array<[string, unknown, boolean]> = [
      ['empty object', {}, true],
      ['plain object', { key: 'value' }, true],
      ['null', null, false],
      ['string primitive', 'string', false],
      ['number primitive', 123, false],
      ['boolean primitive', true, false],
      ['undefined', undefined, false],
      ['array', [], true],
    ];

    for (const [name, value, expected] of cases) {
      it(`returns ${expected} for ${name}`, () => {
        expect(isRecord(value)).toBe(expected);
      });
    }
  });

  describe('parseOptional', () => {
    const { z } = require('zod');
    const schema = z.string();

    it('returns undefined for undefined value', () => {
      expect(parseOptional(schema, undefined)).toBeUndefined();
    });

    it('parses valid value', () => {
      expect(parseOptional(schema, 'test')).toBe('test');
    });

    it('throws for invalid value', () => {
      expect(() => parseOptional(schema, 123)).toThrow();
    });
  });

  describe('resolveBearerToken', () => {
    const validCases: Array<[string, unknown, string]> = [
      ['string token', 'my-token', 'my-token'],
      ['string token with whitespace', '  my-token  ', 'my-token'],
      ['object with access_token', { access_token: 'access-token-value' }, 'access-token-value'],
      ['object with token field', { token: 'token-field-value' }, 'token-field-value'],
      ['object with both token fields', { access_token: 'access', token: 'token' }, 'access'],
    ];

    for (const [name, payload, expected] of validCases) {
      it(`returns ok for ${name}`, () => {
        expect(resolveBearerToken(payload as AuthTokenPayload)).toEqual(ok(expected));
      });
    }

    const invalidCases: Array<[string, unknown]> = [
      ['object with empty string values', { access_token: '', token: '' }],
      ['whitespace-only string token payload', '   '],
      ['object token payload with whitespace-only value', { access_token: '   ' }],
      ['invalid object shape', { invalid: 'field' }],
      ['non-string access_token value', { access_token: 123 }],
    ];

    for (const [name, payload] of invalidCases) {
      it(`returns error for ${name}`, () => {
        expect(resolveBearerToken(payload as AuthTokenPayload)).toEqual(err('TOKEN_INVALID'));
      });
    }
  });

  describe('parseErrorPayload', () => {
    const cases: Array<[string, ResponseInit, string, { body?: unknown; message: string }]> = [
      [
        'empty text with statusText',
        { status: 500, statusText: 'Internal Server Error' },
        '',
        { body: '', message: 'Internal Server Error' },
      ],
      ['empty text without statusText', { status: 500 }, '', { message: 'Request failed' }],
      [
        'non-JSON text',
        { status: 400, statusText: 'Bad Request' },
        'not json',
        { body: 'not json', message: 'Bad Request' },
      ],
      [
        'JSON detail field',
        { status: 400 },
        JSON.stringify({ detail: 'Validation error' }),
        { body: { detail: 'Validation error' }, message: 'Validation error' },
      ],
      [
        'JSON without detail and with statusText',
        { status: 400, statusText: 'Bad Request' },
        JSON.stringify({ error: 'something' }),
        { body: { error: 'something' }, message: 'Bad Request' },
      ],
      [
        'JSON without detail or statusText',
        { status: 400 },
        JSON.stringify({ error: 'something' }),
        { message: '{"error":"something"}' },
      ],
      [
        'non-string detail',
        { status: 422, statusText: 'Unprocessable Entity' },
        JSON.stringify({ detail: { field: 'email', reason: 'invalid' } }),
        {
          body: { detail: { field: 'email', reason: 'invalid' } },
          message: 'Unprocessable Entity',
        },
      ],
      [
        'plain text body without statusText',
        { status: 500 },
        'backend exploded',
        { message: 'backend exploded' },
      ],
    ];

    for (const [name, init, text, expected] of cases) {
      it(`parses ${name}`, () => {
        const result = parseErrorPayload(new Response(null, init), text);
        if ('body' in expected) {
          expect(result.body).toEqual(expected.body);
        }
        expect(result.message).toBe(expected.message);
      });
    }
  });

  describe('parseSuccessPayload', () => {
    it('returns text when parseJson is false', async () => {
      const response = new Response('plain text', { status: 200 });
      const result = await parseSuccessPayload<string>(response, false);
      expect(result).toBe('plain text');
    });

    it('returns undefined for 204 status', async () => {
      const response = new Response(null, { status: 204 });
      const result = await parseSuccessPayload(response, true);
      expect(result).toBeUndefined();
    });

    it('parses JSON for JSON response', async () => {
      const response = jsonResponse({ data: 'test' });
      const result = await parseSuccessPayload<{ data: string }>(response, true);
      expect(result).toEqual({ data: 'test' });
    });

    it('returns undefined for non-JSON response when parseJson is true', async () => {
      const response = new Response('plain text', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
      const result = await parseSuccessPayload(response, true);
      expect(result).toBeUndefined();
    });
  });

  describe('applyAuthorizationHeader', () => {
    const metricLabels = { baseUrl: 'test', method: 'GET', path: '/test' };
    let mockMetrics: {
      incrementCounter: ReturnType<typeof vi.fn>;
      startTimer: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
      mockMetrics = { incrementCounter: vi.fn(), startTimer: vi.fn(() => () => {}) };
    });

    it('skips when Authorization header is already present', async () => {
      const headers = new Headers({ Authorization: 'Bearer existing' });
      const resolveToken = vi.fn().mockResolvedValue(ok('new-token'));

      await applyAuthorizationHeader(headers, metricLabels, mockMetrics, resolveToken);

      expect(headers.get('Authorization')).toBe('Bearer existing');
      expect(resolveToken).not.toHaveBeenCalled();
      expect(mockMetrics.incrementCounter).not.toHaveBeenCalled();
    });

    const tokenMetricCases: Array<
      [string, ReturnType<typeof ok> | ReturnType<typeof err>, string]
    > = [
      ['missing token', err('TOKEN_MISSING'), 'api.client.token.missing'],
      ['invalid object token', ok({ invalid: 'shape' }), 'api.client.token.invalid'],
      ['whitespace-only token', ok('   '), 'api.client.token.invalid'],
    ];

    for (const [name, tokenResult, metric] of tokenMetricCases) {
      it(`increments ${metric} for ${name}`, async () => {
        const headers = new Headers();

        await applyAuthorizationHeader(
          headers,
          metricLabels,
          mockMetrics,
          vi.fn().mockResolvedValue(tokenResult)
        );

        expect(headers.has('Authorization')).toBe(false);
        expect(mockMetrics.incrementCounter).toHaveBeenCalledWith(metric, expect.any(Object));
      });
    }

    const validTokenCases: Array<[string, ReturnType<typeof ok>, string]> = [
      ['string token', ok('valid-token'), 'Bearer valid-token'],
      [
        'object token with access_token',
        ok({ access_token: 'access-value' }),
        'Bearer access-value',
      ],
      ['object token with token field', ok({ token: 'token-value' }), 'Bearer token-value'],
    ];

    for (const [name, tokenResult, expectedHeader] of validTokenCases) {
      it(`applies valid ${name}`, async () => {
        const headers = new Headers();

        await applyAuthorizationHeader(
          headers,
          metricLabels,
          mockMetrics,
          vi.fn().mockResolvedValue(tokenResult)
        );

        expect(headers.get('Authorization')).toBe(expectedHeader);
        expect(mockMetrics.incrementCounter).toHaveBeenCalledWith(
          'api.client.token.applied',
          expect.any(Object)
        );
      });
    }

    it('does not override lowercase authorization header', async () => {
      const headers = new Headers({ authorization: 'Bearer existing-lowercase' });
      const resolveToken = vi.fn().mockResolvedValue(ok('new-token'));

      await applyAuthorizationHeader(headers, metricLabels, mockMetrics, resolveToken);

      expect(headers.get('Authorization')).toBe('Bearer existing-lowercase');
      expect(mockMetrics.incrementCounter).not.toHaveBeenCalledWith(
        'api.client.token.applied',
        expect.any(Object)
      );
    });
  });
});
