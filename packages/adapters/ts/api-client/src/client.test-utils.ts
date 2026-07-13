import { vi } from 'bun:test';

void vi.mock('../../../../qa/observability', () => ({
  metrics: {
    incrementCounter: vi.fn(),
    setGauge: vi.fn(),
    recordHistogram: vi.fn(),
    startTimer: () => () => {},
  },
  resetMetrics: vi.fn(),
  trackRenderCount: vi.fn(),
  recordQueryLatency: vi.fn(),
  recordCacheDivergence: vi.fn(),
}));

import { createApiClient } from './client';

export const createJsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

export type MockFn = ReturnType<typeof vi.fn> & {
  mock: { calls: unknown[][] };
  mockResolvedValueOnce: (value: Response) => MockFn;
};

export const createFetchMock = (
  impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
): typeof fetch & MockFn =>
  Object.assign(vi.fn(impl), { preconnect: vi.fn() }) as typeof fetch & MockFn;

export const createClientHarness = (
  responses: Response | Response[],
  options: Omit<NonNullable<Parameters<typeof createApiClient>[0]>, 'fetchImpl'> = {}
) => {
  const queue = Array.isArray(responses) ? [...responses] : [responses];
  const fetchMock = createFetchMock(async () => {
    const next = queue.shift();
    if (!next) throw new Error('Unexpected request');
    return next;
  });
  return { client: createApiClient({ ...options, fetchImpl: fetchMock }), fetchMock };
};

export const fetchCall = (
  fetchMock: MockFn,
  index = 0
): [RequestInfo | URL, RequestInit | undefined] => {
  const call = fetchMock.mock.calls[index];
  if (!call) throw new Error(`No fetch call at index ${index}`);
  return call as [RequestInfo | URL, RequestInit | undefined];
};

export const createUserPayload = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  email: 'test@example.com',
  full_name: 'Test User',
  plan: 'free',
  message_count: 0,
  free_tasks_remaining: 0,
  last_message_timestamp: null,
  subscription_id: null,
  subscription_status: null,
  subscription_source: 'stripe',
  current_period_start: null,
  current_period_end: null,
  cancel_at_period_end: false,
  theme_preference: 'light',
  memory_enabled: true,
  web_search_enabled: true,
  code_execution_enabled: true,
  notifications_enabled: true,
  quick_mode_enabled: true,
  trust_layer_enabled: false,
  customer_id: null,
  disabled: 'false',
  is_admin: false,
  trial_ends_at: null,
  ...overrides,
});
