import { describe, expect, it, vi } from 'bun:test';

import { fetchModelOptions } from './models';

const modelResponse = {
  enabled: true,
  defaultModelId: 'gpt-5.1',
  options: [
    {
      id: 'gpt-5.1',
      label: 'GPT-5.1',
      badge: 'Default',
      description: 'General purpose',
      usageMultiple: 1,
    },
  ],
};

describe('fetchModelOptions', () => {
  it('fetches and validates model options', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(modelResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );

    const result = await fetchModelOptions({
      baseUrl: 'https://app.taskforceai.chat',
      cache: 'no-store',
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(result).toEqual({ ok: true, value: modelResponse });
    expect(fetchMock).toHaveBeenCalledWith('https://app.taskforceai.chat/api/v1/models', {
      cache: 'no-store',
    });
  });

  it('returns status errors for non-ok responses', async () => {
    const result = await fetchModelOptions({
      baseUrl: 'https://app.taskforceai.chat',
      fetch: vi.fn(async () => new Response(null, { status: 503 })) as unknown as typeof fetch,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Failed to fetch models: 503');
      expect((result.error as Error & { status?: number }).status).toBe(503);
    }
  });

  it('rejects invalid response schemas', async () => {
    const result = await fetchModelOptions({
      baseUrl: 'https://app.taskforceai.chat',
      fetch: vi.fn(
        async () =>
          new Response(JSON.stringify({ enabled: true, options: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
      ) as unknown as typeof fetch,
    });

    expect(result).toEqual({
      ok: false,
      error: new Error('Invalid model options response schema'),
    });
  });

  it('normalizes thrown non-Error failures', async () => {
    const result = await fetchModelOptions({
      baseUrl: 'https://app.taskforceai.chat',
      fetch: vi.fn(async () => {
        throw 'offline';
      }) as unknown as typeof fetch,
    });

    expect(result).toEqual({ ok: false, error: new Error('offline') });
  });
});
