import { describe, it, expect, vi } from 'bun:test';
import { buildUserState, loadUserProfile } from './auth-service';
import { type AccountError, fetchCurrentUser } from '../api/account';
import { ok, err } from '../utils/result';

vi.mock('../api/account', () => ({
  fetchCurrentUser: vi.fn(),
}));

describe('auth-service', () => {
  describe('buildUserState', () => {
    it('returns default state when no overrides provided', () => {
      const state = buildUserState({});
      expect(state.email).toBe('');
      expect(state.plan).toBe('free');
      expect(state.memory_enabled).toBe(true);
      expect(state.quick_mode_enabled).toBe(false);
    });

    it('applies overrides correctly', () => {
      const state = buildUserState({
        email: 'test@example.com',
        plan: 'pro',
        memory_enabled: false,
      });
      expect(state.email).toBe('test@example.com');
      expect(state.plan).toBe('pro');
      expect(state.memory_enabled).toBe(false);
    });
  });

  describe('loadUserProfile', () => {
    it('returns user state on successful fetch', async () => {
      const mockUser = { email: 'user@example.com', plan: 'free' };
      (fetchCurrentUser as any).mockResolvedValue(ok(mockUser));

      const result = await loadUserProfile();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.email).toBe('user@example.com');
        expect(result.value.memory_enabled).toBe(true); // default from buildUserState
      }
    });

    it('returns error on failed fetch', async () => {
      const mockError: AccountError = { kind: 'unauthorized', message: 'Failed' };
      (fetchCurrentUser as any).mockResolvedValue(err(mockError));

      const result = await loadUserProfile();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toEqual(mockError);
      }
    });
  });
});
