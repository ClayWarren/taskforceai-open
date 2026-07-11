import { afterEach, vi } from 'bun:test';

import packageJson from '../package.json';
import { TaskForceAI, TaskForceAIError, VERSION, type TaskStatus } from '../src/index';
import { makeRequest } from '../src/transport';

const globalWithFetch = globalThis as { fetch?: unknown };
const originalFetch = globalWithFetch.fetch;

export const TEST_BASE_URL = 'https://example.com/api/v1/developer';
export const TRANSPORT_CONFIG = {
  apiKey: 'key',
  baseUrl: TEST_BASE_URL,
  timeout: 1_000,
};

export function installFetchMock(fetchMock = vi.fn()) {
  globalWithFetch.fetch = fetchMock;
  return fetchMock;
}

export function installFetchResponses(...responses: Response[]) {
  return installFetchMock(
    vi.fn(() => Promise.resolve(responses.shift() ?? new Response(null, { status: 204 })))
  );
}

export function installJsonResponse(data: unknown, init: ResponseInit = {}) {
  return installFetchResponses(createMockResponse(data, init));
}

export function createClient(options: Partial<ConstructorParameters<typeof TaskForceAI>[0]> = {}) {
  return new TaskForceAI({
    apiKey: 'key',
    baseUrl: TEST_BASE_URL,
    ...options,
  });
}

export function createMockResponse(data: unknown, init: ResponseInit = {}): Response {
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

export function createErrorResponse(text: string, status: number): Response {
  return {
    ok: false,
    status,
    text: () => Promise.resolve(text),
  } as Response;
}

export function requestFromCall(call: unknown[] | undefined): Request {
  if (!call) {
    throw new Error('Expected fetch call to exist');
  }
  const [input, init] = call as [RequestInfo | URL, RequestInit | undefined];
  return new Request(input, init);
}

export function formDataField(formData: unknown, name: string): unknown {
  return (formData as unknown as { get(name: string): unknown }).get(name);
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

export { makeRequest, packageJson, TaskForceAI, TaskForceAIError, VERSION };
export type { TaskStatus };
