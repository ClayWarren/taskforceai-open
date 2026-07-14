import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

const withCsrfMock = mock(async (requestInit: RequestInit) => requestInit);

mock.module('@taskforceai/api-client/auth/csrf', () => ({
  withCsrf: withCsrfMock,
}));

const { submitMessageFeedback } = await import('./messages');
const originalFetch = globalThis.fetch;

beforeEach(() => withCsrfMock.mockClear());
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('submitMessageFeedback', () => {
  it.each([
    [200, 'updated'],
    [403, 'not-rateable'],
    [404, 'not-rateable'],
  ] as const)('maps HTTP %d to %s', async (status, expected) => {
    globalThis.fetch = mock(async () => new Response(null, { status })) as unknown as typeof fetch;

    await expect(submitMessageFeedback('message-1', 1)).resolves.toBe(expected);
  });

  it('encodes the message id and rejects unexpected responses', async () => {
    const fetchMock = mock(
      async () => new Response(null, { status: 500, statusText: 'Server Error' })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(submitMessageFeedback('../message-1', -1)).rejects.toThrow(
      'Failed to submit feedback: Server Error'
    );
    expect(withCsrfMock).toHaveBeenLastCalledWith({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: -1 }),
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/messages/..%2Fmessage-1/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: -1 }),
    });
  });
});
