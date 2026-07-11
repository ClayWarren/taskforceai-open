import { describe, expect, it, vi } from 'bun:test';

import { installFetchMock, TaskForceAI } from '../test/index-test-helpers';

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
