import { describe, expect, it, vi } from 'bun:test';

vi.mock('@taskforceai/contracts/auth/csrf', () => ({
  getCsrfToken: vi.fn().mockResolvedValue('mock-csrf-token'),
  withCsrf: vi.fn(async (init: RequestInit = {}) => init),
}));

import { upsertAgent, fetchAgents } from './agents';

describe('agents API', () => {
  describe('upsertAgent', () => {
    it('returns success with result on 200', async () => {
      const mockResult = { id: '1', name: 'Test Agent' };
      (global as any).fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResult),
      });

      const result = await upsertAgent({ name: 'Test Agent', autonomyEnabled: false });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(mockResult);
      }
    });

    it('returns error on non-ok response', async () => {
      (global as any).fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ message: 'Error message' }),
      });

      const result = await upsertAgent({ name: 'Test Agent', autonomyEnabled: false });
      expect(result.ok).toBe(false);
    });

    it('sends agent id when provided', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'agent-1', name: 'Test Agent' }),
      });
      (global as any).fetch = fetchMock;

      await upsertAgent({ id: 'agent-1', name: 'Test Agent', autonomyEnabled: true });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const firstCall = fetchMock.mock.calls[0];
      if (!firstCall) {
        throw new Error('Expected fetch to be called once');
      }
      const requestInit = firstCall[1] as RequestInit;
      const requestBody = requestInit?.body;
      if (typeof requestBody !== 'string') {
        throw new Error('Expected request body to be a JSON string');
      }
      const parsedBody = JSON.parse(requestBody);
      expect(parsedBody.id).toBe('agent-1');
      expect(parsedBody.autonomyEnabled).toBe(true);
    });
  });

  describe('fetchAgents', () => {
    it('returns agents on success', async () => {
      const mockAgents = [
        { id: '1', name: 'Agent 1' },
        { id: '2', name: 'Agent 2' },
      ];
      (global as any).fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockAgents),
      });

      const result = await fetchAgents();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(mockAgents);
      }
    });

    it('returns error on failure', async () => {
      (global as any).fetch = vi.fn().mockResolvedValue({
        ok: false,
      });

      const result = await fetchAgents();
      expect(result.ok).toBe(false);
    });

    it('returns error when response body is not a valid agent array', async () => {
      (global as any).fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([{ id: 123, name: 'Agent' }]),
      });

      const result = await fetchAgents();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Invalid response from server');
      }
    });
  });
});
