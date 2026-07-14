import { describe, expect, it, vi } from 'bun:test';

vi.mock('@taskforceai/api-client/auth/csrf', () => ({
  getCsrfToken: vi.fn().mockResolvedValue('mock-csrf-token'),
  withCsrf: vi.fn(async (init: RequestInit = {}) => init),
}));

import { upsertAgent, fetchAgents } from './agents';

const timestamp = '2026-07-12T19:00:00';

const agentFixture = (id: string, name: string) => ({
  active_days: [0, 1, 2, 3, 4, 5, 6],
  active_end: '23:59',
  active_start: '00:00',
  autonomy_enabled: true,
  avatar: null,
  check_interval: 600,
  created_at: timestamp,
  description: null,
  id,
  last_run_at: null,
  model_id: null,
  name,
  next_run_at: timestamp,
  status: 'active',
  timezone: 'America/Chicago',
  updated_at: timestamp,
  user_id: 1,
});

describe('agents API', () => {
  describe('upsertAgent', () => {
    it('returns success with result on 200', async () => {
      const mockResult = agentFixture('1', 'Test Agent');
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
        json: () => Promise.resolve(agentFixture('agent-1', 'Test Agent')),
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
      const mockAgents = [agentFixture('1', 'Agent 1'), agentFixture('2', 'Agent 2')];
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
