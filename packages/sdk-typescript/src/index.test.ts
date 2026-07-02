import { afterEach, describe, expect, it, vi } from 'bun:test';

import packageJson from '../package.json';
import { TaskForceAI, TaskForceAIError, TaskStatus, VERSION } from './index';
import { makeRequest } from './transport';

const globalWithFetch = globalThis as { fetch?: unknown };
const originalFetch = globalWithFetch.fetch;
const TEST_BASE_URL = 'https://example.com/api/v1/developer';
const TRANSPORT_CONFIG = {
  apiKey: 'key',
  baseUrl: TEST_BASE_URL,
  timeout: 1_000,
};

function installFetchMock(fetchMock = vi.fn()) {
  globalWithFetch.fetch = fetchMock;
  return fetchMock;
}

function installFetchResponses(...responses: Response[]) {
  return installFetchMock(
    vi.fn(() => Promise.resolve(responses.shift() ?? new Response(null, { status: 204 })))
  );
}

function installJsonResponse(data: unknown, init: ResponseInit = {}) {
  return installFetchResponses(createMockResponse(data, init));
}

function createClient(options: Partial<ConstructorParameters<typeof TaskForceAI>[0]> = {}) {
  return new TaskForceAI({
    apiKey: 'key',
    baseUrl: TEST_BASE_URL,
    ...options,
  });
}

function createMockResponse(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return new Response(JSON.stringify(data), {
    ...init,
    status: init.status ?? 200,
    headers,
  });
}

function createErrorResponse(text: string, status: number): Response {
  return {
    ok: false,
    status,
    text: () => Promise.resolve(text),
  } as Response;
}

function requestFromCall(call: unknown[] | undefined): Request {
  if (!call) {
    throw new Error('Expected fetch call to exist');
  }
  const [input, init] = call as [RequestInfo | URL, RequestInit | undefined];
  return new Request(input, init);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  if (originalFetch !== undefined) {
    globalWithFetch.fetch = originalFetch;
  } else {
    delete globalWithFetch.fetch;
  }
});

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

describe('TaskForceAI mock mode', () => {
  it('allows missing api key when mockMode is enabled', () => {
    expect(() => new TaskForceAI({ mockMode: true })).not.toThrow();
  });

  it('throws without api key when mockMode is disabled', () => {
    expect(() => new TaskForceAI({})).toThrow('API key is required when not in mock mode');
  });

  it('returns mock lifecycle responses without network calls', async () => {
    const fetchMock = vi.fn();
    installFetchMock(fetchMock);
    const client = new TaskForceAI({ mockMode: true });

    const taskId = await client.submitTask('mock prompt');
    expect(taskId.startsWith('mock-')).toBe(true);

    const firstStatus = await client.getTaskStatus(taskId);
    const secondStatus = await client.getTaskStatus(taskId);
    const result = await client.getTaskResult(taskId);

    expect(firstStatus.status).toBe('processing');
    expect(secondStatus.status).toBe('completed');
    expect(secondStatus.result).toContain('mock response');
    expect(result.status).toBe('completed');
    expect(result.result).toContain('mock response');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('TaskForceAI task helpers', () => {
  it('validates task identifiers for status and result lookups', async () => {
    const client = new TaskForceAI({ apiKey: 'key' });
    await expect(client.getTaskStatus('')).rejects.toThrow('Task ID must be a non-empty string');
    await expect(client.getTaskResult('')).rejects.toThrow('Task ID must be a non-empty string');
  });

  it('fetches task status and result through makeRequest', async () => {
    const fetchMock = installJsonResponse({ taskId: 'task', status: 'completed', result: 'done' });
    const client = createClient();

    const status = await client.getTaskStatus('task');
    expect(status.status).toBe('completed');

    fetchMock.mockResolvedValueOnce(createMockResponse({ taskId: 'task', result: 'done' }));
    const result = await client.getTaskResult('task');
    expect(result.result).toBe('done');
  });

  it('rejects malformed task lifecycle responses', async () => {
    installFetchResponses(
      createMockResponse({ status: 'processing' }),
      createMockResponse({ taskId: 'task', status: 'unknown' }),
      createMockResponse({ taskId: 'task', status: 'completed' })
    );
    const client = createClient();

    await expect(client.submitTask('prompt')).rejects.toThrow(
      'Invalid task submission response from server'
    );
    await expect(client.getTaskStatus('task')).rejects.toThrow(
      'Invalid task status response from server'
    );
    await expect(client.getTaskResult('task')).rejects.toThrow(
      'Invalid task result response from server'
    );
  });

  it('includes model and image attachment fields in task submissions', async () => {
    const fetchMock = installJsonResponse({ taskId: 'task_images' });
    const client = createClient();

    await client.submitTask('describe this', {
      modelId: 'sentinel-large',
      images: [{ data: 'aGVsbG8=', mime_type: 'image/png', name: 'image.png' }],
    });

    const request = requestFromCall(fetchMock.mock.calls[0]);
    const body = JSON.parse(await request.text()) as {
      modelId?: string;
      attachments?: unknown[];
    };
    expect(body.modelId).toBe('sentinel-large');
    expect(body.attachments).toEqual([
      { data: 'aGVsbG8=', mime_type: 'image/png', name: 'image.png' },
    ]);
  });

  it('handles waitForCompletion terminal, hydration, and failure paths', async () => {
    const successClient = new TaskForceAI({ apiKey: 'key' });
    const statuses: TaskStatus[] = [
      { taskId: 'task', status: 'processing' },
      { taskId: 'task', status: 'completed', result: 'done' },
    ];
    const statusSpy = vi
      .spyOn(successClient, 'getTaskStatus')
      .mockImplementation(async () => statuses.shift() as TaskStatus);
    const seen: TaskStatus[] = [];
    await expect(
      successClient.waitForCompletion('task', 5 as 2000, 5 as 150, (status) => seen.push(status))
    ).resolves.toEqual({ taskId: 'task', status: 'completed', result: 'done' });
    expect(seen).toHaveLength(2);
    expect(statusSpy).toHaveBeenCalledTimes(2);

    const hydrateClient = new TaskForceAI({ apiKey: 'key' });
    vi.spyOn(hydrateClient, 'getTaskStatus').mockResolvedValue({
      taskId: 'task',
      status: 'completed',
    });
    const resultSpy = vi.spyOn(hydrateClient, 'getTaskResult').mockResolvedValue({
      taskId: 'task',
      status: 'completed',
      result: 'resolved-from-results-endpoint',
    });
    await expect(hydrateClient.waitForCompletion('task', 5 as 2000, 1 as 150)).resolves.toEqual({
      taskId: 'task',
      status: 'completed',
      result: 'resolved-from-results-endpoint',
    });
    expect(resultSpy).toHaveBeenCalledWith('task');

    const failedClient = new TaskForceAI({ apiKey: 'key' });
    vi.spyOn(failedClient, 'getTaskStatus')
      .mockResolvedValueOnce({ taskId: 'task', status: 'failed', error: 'boom' })
      .mockResolvedValueOnce({ taskId: 'task', status: 'failed' })
      .mockResolvedValue({ taskId: 'task', status: 'processing' });
    await expect(failedClient.waitForCompletion('task')).rejects.toThrow('boom');
    await expect(failedClient.waitForCompletion('task')).rejects.toThrow('Task failed');
    await expect(failedClient.waitForCompletion('task', 5 as 2000, 2 as 150)).rejects.toThrow(
      'Task did not complete within the expected time'
    );

    const approvalClient = new TaskForceAI({ apiKey: 'key' });
    const approvalSpy = vi
      .spyOn(approvalClient, 'getTaskStatus')
      .mockResolvedValueOnce({ taskId: 'task', status: 'processing' })
      .mockResolvedValueOnce({
        taskId: 'task',
        status: 'awaiting_approval',
        message: 'Approval required',
      });
    await expect(approvalClient.waitForCompletion('task', 0 as 2000, 5 as 150)).rejects.toThrow(
      'Approval required'
    );
    expect(approvalSpy).toHaveBeenCalledTimes(2);
  });

  it('chains runTask through submitTask and waitForCompletion', async () => {
    const client = new TaskForceAI({ apiKey: 'key' });
    const submitSpy = vi.spyOn(client, 'submitTask').mockResolvedValue('task-123');
    const waitSpy = vi.spyOn(client, 'waitForCompletion').mockResolvedValue({
      taskId: 'task-123',
      status: 'completed',
      result: 'ok',
    });

    const result = await client.runTask('prompt', { mock: true }, 10 as 2000, 2 as 150);

    expect(result).toEqual({ taskId: 'task-123', status: 'completed', result: 'ok' });
    expect(submitSpy).toHaveBeenCalledWith('prompt', { mock: true });
    expect(waitSpy).toHaveBeenCalledWith('task-123', 10, 2, undefined);
  });

  it('streams task status updates, terminal approval states, and runTaskStream results', async () => {
    const client = new TaskForceAI({ apiKey: 'key' });
    const statuses: TaskStatus[] = [
      { taskId: 'task', status: 'processing' },
      { taskId: 'task', status: 'completed', result: 'ok' },
    ];
    vi.spyOn(client, 'getTaskStatus').mockImplementation(
      async () => statuses.shift() as TaskStatus
    );

    const received: TaskStatus[] = [];
    for await (const status of client.streamTaskStatus('task', 0 as 2000, 5 as 150)) {
      received.push(status);
    }

    expect(received).toHaveLength(2);
    expect(received[1]?.status).toBe('completed');

    const approvalClient = new TaskForceAI({ apiKey: 'key' });
    const approvalStatuses: TaskStatus[] = [
      { taskId: 'task', status: 'processing' },
      { taskId: 'task', status: 'awaiting_approval', message: 'Approval required' },
    ];
    vi.spyOn(approvalClient, 'getTaskStatus').mockImplementation(
      async () => approvalStatuses.shift() as TaskStatus
    );
    const approvalReceived: TaskStatus[] = [];
    for await (const status of approvalClient.streamTaskStatus('task', 0 as 2000, 5 as 150)) {
      approvalReceived.push(status);
    }
    expect(approvalReceived).toHaveLength(2);
    expect(approvalReceived[1]?.status).toBe('awaiting_approval');

    const runStreamClient = new TaskForceAI({ apiKey: 'key' });
    vi.spyOn(runStreamClient, 'submitTask').mockResolvedValue('task-999');
    vi.spyOn(runStreamClient, 'getTaskStatus').mockResolvedValue({
      taskId: 'task-999',
      status: 'completed',
      result: 'done',
    });
    const stream = await runStreamClient.runTaskStream('prompt');
    const streamStatuses: TaskStatus[] = [];
    for await (const status of stream) {
      streamStatuses.push(status);
    }
    expect(stream.taskId).toBe('task-999');
    expect(streamStatuses).toHaveLength(1);
    expect(streamStatuses[0]?.result).toBe('done');
  });

  it('supports cancelling a task status stream', async () => {
    const client = new TaskForceAI({ apiKey: 'key' });
    vi.spyOn(client, 'getTaskStatus')
      .mockResolvedValueOnce({ taskId: 'task', status: 'processing' })
      .mockResolvedValue({ taskId: 'task', status: 'processing' });

    const stream = client.streamTaskStatus('task', 0 as 2000, 5 as 150);
    const iterator = stream[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.value.status).toBe('processing');
    stream.cancel();
    await expect(iterator.next()).rejects.toThrow('Task stream cancelled');
  });

  it('honors abort signals before polling task status', async () => {
    const controller = new AbortController();
    controller.abort();
    const client = new TaskForceAI({ apiKey: 'key' });
    const statusSpy = vi.spyOn(client, 'getTaskStatus');

    await expect(
      client.waitForCompletion('task', 0 as 2000, 5 as 150, undefined, controller.signal)
    ).rejects.toThrow('Task polling cancelled');
    expect(statusSpy).not.toHaveBeenCalled();
  });
});

describe('TaskForceAI file methods', () => {
  it('uses authenticated server upload flow for files larger than 4MB', async () => {
    const fetchMock = installFetchResponses(
      createMockResponse({
        id: 'file_456',
        filename: 'big.pdf',
        purpose: 'assistants',
        bytes: 5000000,
        created_at: '2026-01-01T00:00:00Z',
        mime_type: 'application/pdf',
      })
    );

    const client = createClient({ apiKey: 'test-api-key' });

    const largeBlob = new Blob([new Uint8Array(4 * 1024 * 1024 + 1)], {
      type: 'application/pdf',
    });
    const result = await client.uploadFile('big.pdf', largeBlob);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const request = requestFromCall(fetchMock.mock.calls[0]);
    expect(request.url).toBe('https://example.com/api/v1/developer/files');
    expect(request.headers.get('x-api-key')).toBe('test-api-key');
    const formData = await request.formData();
    expect(formData.get('purpose')).toBe('assistants');
    expect(formData.get('mime_type')).toBe('application/pdf');
    expect(formData.get('file')).toBeInstanceOf(File);
    expect(result.id).toBe('file_456');

    const failFetchMock = installFetchResponses(new Response(null, { status: 500 }));
    await expect(client.uploadFile('big.pdf', largeBlob)).rejects.toThrow(
      'Failed to upload file: 500'
    );
    expect(failFetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses x-api-key auth and configured fields for small uploads', async () => {
    const fetchMock = installFetchResponses(
      createMockResponse({
        id: 'file_123',
        filename: 'report.txt',
        purpose: 'assistants',
        bytes: 5,
        created_at: '2026-01-01T00:00:00Z',
      }),
      createMockResponse({
        id: 'file_789',
        filename: 'report.json',
        purpose: 'analysis',
        bytes: 2,
        created_at: '2026-01-01T00:00:00Z',
      })
    );
    const client = createClient({ apiKey: 'test-api-key' });

    await client.uploadFile('report.txt', new Blob(['hello']));
    const request = requestFromCall(fetchMock.mock.calls[0]);
    expect(request.url).toBe('https://example.com/api/v1/developer/files');
    expect(request.headers.get('x-api-key')).toBe('test-api-key');
    expect(request.headers.get('authorization')).toBeNull();
    const formData = await request.formData();
    expect(formData.get('purpose')).toBe('assistants');
    expect(formData.get('mime_type')).toBe('application/octet-stream');
    expect(formData.get('file')).toBeInstanceOf(File);

    await client.uploadFile('report.json', new Blob(['{}'], { type: 'application/json' }), {
      purpose: 'analysis',
      mime_type: 'application/custom+json',
    });
    const customFormData = await requestFromCall(fetchMock.mock.calls[1]).formData();
    expect(customFormData.get('purpose')).toBe('analysis');
    expect(customFormData.get('mime_type')).toBe('application/custom+json');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses x-api-key auth header for downloadFile requests', async () => {
    const payload = new Uint8Array([1, 2, 3]).buffer;
    const fetchMock = installFetchResponses(new Response(payload, { status: 200 }));

    const client = createClient({ apiKey: 'test-api-key' });

    const result = await client.downloadFile('file_123');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requestFromCall(fetchMock.mock.calls[0]);
    expect(request.url).toBe('https://example.com/api/v1/developer/files/file_123/content');
    expect(request.headers.get('x-api-key')).toBe('test-api-key');
    expect(request.headers.get('authorization')).toBeNull();
    expect(Array.from(new Uint8Array(result))).toEqual(Array.from(new Uint8Array(payload)));
  });

  it('throws upload and download errors with HTTP status context', async () => {
    installFetchResponses(
      new Response(null, { status: 413 }),
      new Response(new ArrayBuffer(0), { status: 404 }),
      new Response('not-json', { status: 200 })
    );

    const client = createClient({ apiKey: 'test-api-key' });

    await expect(client.uploadFile('report.txt', new Blob(['hello']))).rejects.toThrow(
      'Failed to upload file: 413'
    );
    await expect(client.downloadFile('missing')).rejects.toThrow('Failed to download file: 404');
    await expect(client.uploadFile('bad-response.txt', new Blob(['hello']))).rejects.toMatchObject({
      message: 'Invalid upload response from server',
      statusCode: 200,
    });
  });

  it('validates file identifiers and filenames before issuing requests', async () => {
    const fetchMock = installFetchMock();
    const client = createClient({ apiKey: 'test-api-key' });

    await expect(client.uploadFile('', new Blob(['hello']))).rejects.toThrow(
      'Filename must be a non-empty string'
    );
    await expect(client.getFile('')).rejects.toThrow('File ID must be a non-empty string');
    await expect(client.deleteFile('  ')).rejects.toThrow('File ID must be a non-empty string');
    await expect(client.downloadFile('')).rejects.toThrow('File ID must be a non-empty string');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('TaskForceAI thread and file endpoint methods', () => {
  it('calls thread endpoints with expected URLs and methods', async () => {
    const thread = {
      id: 10,
      user_id: 1,
      title: 'Thread 1',
      metadata: {},
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    const fetchMock = installFetchResponses(
      createMockResponse(thread),
      createMockResponse({ threads: [], total: 0, limit: 20, offset: 0 }),
      createMockResponse(thread),
      createMockResponse({ messages: [], total: 0, limit: 50, offset: 0 }),
      createMockResponse({ task_id: 'task_in_thread', thread_id: 10, message_id: 20 })
    );

    const client = createClient();

    await client.createThread({ title: 'Thread 1' });
    await client.listThreads();
    await client.getThread(10);
    await client.getThreadMessages(10);
    await client.runInThread(10, { prompt: 'hello from thread' });

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(requestFromCall(fetchMock.mock.calls[0]).url).toBe(
      'https://example.com/api/v1/developer/threads'
    );
    expect(requestFromCall(fetchMock.mock.calls[1]).url).toBe(
      'https://example.com/api/v1/developer/threads?limit=20&offset=0'
    );
    expect(requestFromCall(fetchMock.mock.calls[2]).url).toBe(
      'https://example.com/api/v1/developer/threads/10'
    );
    expect(requestFromCall(fetchMock.mock.calls[3]).url).toBe(
      'https://example.com/api/v1/developer/threads/10/messages?limit=50&offset=0'
    );
    expect(requestFromCall(fetchMock.mock.calls[4]).url).toBe(
      'https://example.com/api/v1/developer/threads/10/runs'
    );
    expect(requestFromCall(fetchMock.mock.calls[4]).method).toBe('POST');
  });

  it('validates runInThread prompt and deleteThread unsupported behavior', async () => {
    const client = new TaskForceAI({ apiKey: 'key' });
    await expect(client.runInThread(1, { prompt: '' })).rejects.toThrow(
      'Prompt must be a non-empty string'
    );
    await expect(client.deleteThread(1)).rejects.toThrow('deleteThread is not supported');
  });

  it('validates thread identifiers before issuing requests', async () => {
    const fetchMock = installFetchMock();
    const client = new TaskForceAI({ apiKey: 'key' });

    await expect(client.getThread(0)).rejects.toThrow('Thread ID must be a positive integer');
    await expect(client.getThreadMessages(Number.NaN)).rejects.toThrow(
      'Thread ID must be a positive integer'
    );
    await expect(client.runInThread(-1, { prompt: 'hello' })).rejects.toThrow(
      'Thread ID must be a positive integer'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls file list/get/delete endpoints', async () => {
    const fetchMock = installFetchResponses(
      createMockResponse({ data: [], total: 0, limit: 20, offset: 0 }),
      createMockResponse({
        id: 'file_1',
        filename: 'doc.txt',
        purpose: 'assistants',
        bytes: 5,
        created_at: '2026-01-01T00:00:00Z',
        mime_type: 'text/plain',
      }),
      createMockResponse({})
    );

    const client = createClient();

    const list = await client.listFiles();
    expect(list.total).toBe(0);
    const file = await client.getFile('file_1');
    expect(file.id).toBe('file_1');
    await client.deleteFile('file_1');

    expect(requestFromCall(fetchMock.mock.calls[0]).url).toBe(
      'https://example.com/api/v1/developer/files?limit=20&offset=0'
    );
    expect(requestFromCall(fetchMock.mock.calls[1]).url).toBe(
      'https://example.com/api/v1/developer/files/file_1'
    );
    expect(requestFromCall(fetchMock.mock.calls[2]).url).toBe(
      'https://example.com/api/v1/developer/files/file_1'
    );
    expect(requestFromCall(fetchMock.mock.calls[2]).method).toBe('DELETE');
  });

  it('rejects malformed thread and file endpoint responses', async () => {
    installFetchResponses(
      createMockResponse({ id: 'not-a-number', title: 'Bad thread' }),
      createMockResponse({ threads: [{ id: 1, title: 'Missing timestamps' }], total: 1 }),
      createMockResponse({
        messages: [{ id: 1, thread_id: 2, role: 'system', content: 'bad', created_at: 'now' }],
        total: 1,
      }),
      createMockResponse({ task_id: 'task', thread_id: 1 }),
      createMockResponse({ data: [{ id: 'file_1', filename: 'missing metadata' }], total: 1 }),
      createMockResponse({ id: 'file_1', filename: 'missing metadata' })
    );

    const client = createClient();

    await expect(client.createThread({ title: 'bad' })).rejects.toThrow(
      'Invalid thread response from server'
    );
    await expect(client.listThreads()).rejects.toThrow(
      'Invalid thread list item 0 response from server'
    );
    await expect(client.getThreadMessages(2)).rejects.toThrow(
      'Invalid thread message 0 response from server'
    );
    await expect(client.runInThread(1, { prompt: 'hello' })).rejects.toThrow(
      'Invalid thread run response from server'
    );
    await expect(client.listFiles()).rejects.toThrow(
      'Invalid file list item 0 response from server'
    );
    await expect(client.getFile('file_1')).rejects.toThrow('Invalid file response from server');
  });
});
