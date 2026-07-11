import { describe, expect, it, vi } from 'bun:test';

import {
  createClient,
  createErrorResponse,
  createMockResponse,
  installFetchMock,
  installFetchResponses,
  installJsonResponse,
  makeRequest,
  packageJson,
  requestFromCall,
  TaskForceAI,
  TaskForceAIError,
  TRANSPORT_CONFIG,
  VERSION,
} from '../test/index-test-helpers';

describe('TaskForceAI.makeRequest and helpers', () => {
  it('exports a concrete SDK version', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(VERSION).toBe(packageJson.version);
  });

  it('throws a TaskForceAIError when prompt is invalid', async () => {
    const client = new TaskForceAI({ apiKey: 'key' });
    await expect(client.submitTask('')).rejects.toThrow('Prompt must be a non-empty string');
  });

  const errorResponseCases = [
    {
      name: 'extracts JSON error messages from failed responses with HTTP context',
      response: () => createErrorResponse('{"error":"Not found"}', 404),
      expected: { message: 'HTTP 404: Not found', statusCode: 404 },
    },
    {
      name: 'uses message field while preserving HTTP context',
      response: () => createErrorResponse('{"message":"oops"}', 500),
      expected: { message: 'HTTP 500: oops', statusCode: 500 },
    },
    {
      name: 'tolerates malformed JSON error payloads and keeps HTTP context',
      response: () => createErrorResponse('{"error":"bad gateway"', 502),
      expected: { message: 'HTTP 502: {"error":"bad gateway"', statusCode: 502 },
    },
    {
      name: 'falls back to raw JSON text when error fields are blank',
      response: () => createErrorResponse('{"error":" ","message":"\\t"}', 422),
      expected: { message: 'HTTP 422: {"error":" ","message":"\\t"}', statusCode: 422 },
    },
  ];

  for (const { name, response, expected } of errorResponseCases) {
    it(name, async () => {
      installFetchMock(vi.fn().mockImplementation(() => Promise.resolve(response())));
      await expect(
        makeRequest<{ ok: boolean }>('/error', { method: 'GET' }, TRANSPORT_CONFIG)
      ).rejects.toMatchObject(expected);
    });
  }

  it('uses HTTP context when reading an error body fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: () => Promise.reject(new Error('body unavailable')),
    } as Response);
    installFetchMock(fetchMock);

    await expect(
      makeRequest<{ ok: boolean }>('/bad-body', { method: 'GET' }, TRANSPORT_CONFIG)
    ).rejects.toMatchObject({
      message: 'HTTP 502',
      statusCode: 502,
    });
  });

  it('handles empty success responses and wraps malformed success JSON', async () => {
    installFetchResponses(
      new Response(null, { status: 204 }),
      new Response('', { status: 200 }),
      new Response('not-json', { status: 200 })
    );

    await expect(
      makeRequest<void>('/empty-204', { method: 'DELETE' }, TRANSPORT_CONFIG)
    ).resolves.toBeUndefined();
    await expect(
      makeRequest<void>('/empty-200', { method: 'DELETE' }, TRANSPORT_CONFIG)
    ).resolves.toBeUndefined();
    await expect(
      makeRequest<{ ok: boolean }>('/bad-json', { method: 'GET' }, TRANSPORT_CONFIG)
    ).rejects.toMatchObject({
      message: 'Invalid JSON response from server',
      statusCode: 200,
    });
  });

  it('wraps Error and non-Error network failures', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('unreachable'))
      .mockRejectedValueOnce('fail');
    installFetchMock(fetchMock);
    const client = new TaskForceAI({ apiKey: 'key' });

    await expect(client.submitTask('prompt')).rejects.toThrow('Network error: unreachable');
    await expect(client.submitTask('prompt')).rejects.toThrow('Network error: Unknown error');
  });

  it('converts AbortError into timeout error', async () => {
    vi.useRealTimers();
    const fetchMock = vi.fn((_url: unknown, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal | undefined;
      let settled = false;

      return new Promise((_, reject) => {
        const abortHandler = () => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener('abort', abortHandler);
          const error = new Error('Aborted');
          error.name = 'AbortError';
          reject(error);
        };

        signal?.addEventListener('abort', abortHandler);
        setTimeout(() => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener('abort', abortHandler);
          reject(new Error('fetch did not abort in time'));
        }, 100);
      });
    });
    installFetchMock(fetchMock);

    const client = new TaskForceAI({ apiKey: 'key', timeout: 20 });
    await expect(client.getTaskStatus('slow-task')).rejects.toThrow(/timeout/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('converts body read AbortError into timeout error', async () => {
    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';
    const fetchMock = installFetchMock(
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.reject(abortError),
      } as Response)
    );

    await expect(
      makeRequest<{ ok: boolean }>('/slow-body', { method: 'GET' }, TRANSPORT_CONFIG)
    ).rejects.toThrow(/timeout/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('invokes responseHook with the raw fetch response', async () => {
    const fetchMock = installJsonResponse({
      taskId: 'task_hook',
      status: 'completed',
      result: 'ok',
    });
    const hook = vi.fn();

    const client = new TaskForceAI({ apiKey: 'key', responseHook: hook });
    await client.getTaskStatus('task_hook');

    expect(hook).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('handles retryable and non-retryable transport outcomes', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const fetchMock = installFetchResponses(
      createMockResponse({ error: 'rate limit' }, { status: 429, headers: { 'retry-after': '0' } }),
      createMockResponse({ taskId: 'task', status: 'completed' }),
      createMockResponse(
        { error: 'unavailable' },
        { status: 503, headers: { 'retry-after': '0' } }
      ),
      createMockResponse({ ok: true }),
      createMockResponse({ error: 'bad request' }, { status: 400 }),
      new Response('', { status: 418 }),
      createMockResponse({ error: 'still down' }, { status: 503 }),
      createMockResponse({ error: 'still down' }, { status: 503 }),
      createMockResponse(
        { error: 'try later' },
        { status: 503, headers: { 'retry-after': 'Thu, 01 Jan 1970 00:00:00 GMT' } }
      ),
      createMockResponse({ ok: true }),
      createMockResponse(
        { error: 'request timeout' },
        { status: 408, headers: { 'retry-after': '0' } }
      ),
      createMockResponse({ ok: true }),
      createMockResponse({ error: 'conflict' }, { status: 409 }),
      createMockResponse(
        { error: 'server error' },
        { status: 500, headers: { 'retry-after': '0' } }
      ),
      createMockResponse({ ok: true }),
      {
        ok: false,
        status: 600,
        text: () => Promise.resolve('{"error":"edge status"}'),
      } as Response
    );

    await expect(createClient().getTaskStatus('task')).resolves.toMatchObject({
      status: 'completed',
    });
    const result = await makeRequest<{ ok: boolean }>(
      '/health',
      { method: 'GET' },
      TRANSPORT_CONFIG,
      true,
      1
    );

    expect(result).toEqual({ ok: true });
    expect(requestFromCall(fetchMock.mock.calls[0]).url).toBe(
      'https://example.com/api/v1/developer/status/task'
    );
    expect(requestFromCall(fetchMock.mock.calls[2]).url).toBe(
      'https://example.com/api/v1/developer/health'
    );

    await expect(
      makeRequest<{ ok: boolean }>('/health', { method: 'GET' }, TRANSPORT_CONFIG, true, 3)
    ).rejects.toMatchObject({
      message: 'HTTP 400: bad request',
      statusCode: 400,
    });
    await expect(
      makeRequest<{ ok: boolean }>('/teapot', { method: 'GET' }, TRANSPORT_CONFIG)
    ).rejects.toMatchObject({
      message: 'HTTP 418',
      statusCode: 418,
    });
    await expect(
      makeRequest<{ ok: boolean }>('/exhausted', { method: 'GET' }, TRANSPORT_CONFIG, true, 1)
    ).rejects.toMatchObject({
      message: 'HTTP 503: still down',
      statusCode: 503,
    });
    await expect(
      makeRequest<{ ok: boolean }>('/date-retry', { method: 'GET' }, TRANSPORT_CONFIG, true, 1)
    ).resolves.toEqual({ ok: true });
    await expect(
      makeRequest<{ ok: boolean }>('/retry-timeout', { method: 'GET' }, TRANSPORT_CONFIG, true, 1)
    ).resolves.toEqual({ ok: true });
    await expect(
      makeRequest<{ ok: boolean }>('/conflict', { method: 'GET' }, TRANSPORT_CONFIG, true, 1)
    ).rejects.toMatchObject({
      message: 'HTTP 409: conflict',
      statusCode: 409,
    });
    await expect(
      makeRequest<{ ok: boolean }>('/retry-500', { method: 'GET' }, TRANSPORT_CONFIG, true, 1)
    ).resolves.toEqual({ ok: true });
    await expect(
      makeRequest<{ ok: boolean }>('/status-600', { method: 'GET' }, TRANSPORT_CONFIG, true, 1)
    ).rejects.toMatchObject({
      message: 'HTTP 600: edge status',
      statusCode: 600,
    });
    expect(fetchMock).toHaveBeenCalledTimes(16);
  });

  it('retries thrown network errors when the request is retryable', async () => {
    const fetchMock = installFetchMock(
      vi
        .fn()
        .mockRejectedValueOnce(new Error('connection reset'))
        .mockResolvedValueOnce(createMockResponse({ ok: true }))
    );

    const result = await makeRequest<{ ok: boolean }>(
      '/date-retry',
      { method: 'GET' },
      TRANSPORT_CONFIG,
      true,
      1
    );

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('cancels retry backoff when the caller aborts', async () => {
    vi.useRealTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const controller = new AbortController();
    const fetchMock = installFetchResponses(
      createMockResponse({ error: 'try later' }, { status: 503, headers: { 'retry-after': '5' } }),
      createMockResponse({ ok: true })
    );

    const request = makeRequest<{ ok: boolean }>(
      '/retry-after',
      { method: 'GET', signal: controller.signal },
      TRANSPORT_CONFIG,
      true,
      1
    );

    setTimeout(() => controller.abort(), 10);

    await expect(request).rejects.toThrow('Request cancelled');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('normalizes aborts during retry backoff after thrown network errors', async () => {
    vi.useRealTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const controller = new AbortController();
    const fetchMock = installFetchMock(
      vi
        .fn()
        .mockRejectedValueOnce(new Error('connection reset'))
        .mockResolvedValueOnce(createMockResponse({ ok: true }))
    );

    const request = makeRequest<{ ok: boolean }>(
      '/network-retry-abort',
      { method: 'GET', signal: controller.signal },
      TRANSPORT_CONFIG,
      true,
      1
    );

    setTimeout(() => controller.abort(), 10);

    try {
      await request;
      throw new Error('Expected request to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(TaskForceAIError);
      expect((error as Error).message).toBe('Request cancelled');
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps caller abort signals wired into requests', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_url: unknown, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal | undefined;
      expect(signal?.aborted).toBe(false);
      controller.abort();
      expect(signal?.aborted).toBe(true);
      return Promise.resolve(createMockResponse({ ok: true }));
    });
    installFetchMock(fetchMock);

    await expect(
      makeRequest<{ ok: boolean }>(
        '/abort-signal',
        { method: 'GET', signal: controller.signal },
        TRANSPORT_CONFIG
      )
    ).resolves.toEqual({ ok: true });
  });

  it('normalizes Headers object inputs while preserving SDK defaults', async () => {
    const fetchMock = installJsonResponse({ ok: true });

    await makeRequest<{ ok: boolean }>(
      '/headers',
      {
        method: 'POST',
        headers: new Headers({
          'x-custom-header': 'custom-value',
          'Content-Type': 'text/plain',
        }),
        body: 'payload',
      },
      TRANSPORT_CONFIG
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requestFromCall(fetchMock.mock.calls[0]);
    expect(request.headers.get('x-custom-header')).toBe('custom-value');
    expect(request.headers.get('content-type')).toBe('text/plain');
    expect(request.headers.get('x-api-key')).toBe('key');
    expect(request.headers.get('x-sdk-language')).toBe('typescript');
  });

  it('normalizes header tuple arrays and ignores undefined object values', async () => {
    const fetchMock = installFetchResponses(
      createMockResponse({ tuple: true }),
      createMockResponse({ object: true })
    );

    await makeRequest<{ tuple: boolean }>(
      '/tuple-headers',
      {
        method: 'GET',
        headers: [['x-tuple-header', 'tuple-value']],
      },
      TRANSPORT_CONFIG
    );

    await makeRequest<{ object: boolean }>(
      '/object-headers',
      {
        method: 'GET',
        headers: {
          'x-defined-header': 'defined-value',
        },
      },
      TRANSPORT_CONFIG
    );

    const tupleRequest = requestFromCall(fetchMock.mock.calls[0]);
    expect(tupleRequest.headers.get('x-tuple-header')).toBe('tuple-value');
    const objectRequest = requestFromCall(fetchMock.mock.calls[1]);
    expect(objectRequest.headers.get('x-defined-header')).toBe('defined-value');
    expect(objectRequest.headers.get('x-undefined-header')).toBeNull();
  });
});
