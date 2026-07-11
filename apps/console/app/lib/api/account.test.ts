import { describe, it, expect, vi, beforeEach } from 'bun:test';
import {
  fetchCurrentUser,
  logoutUser,
  updateUserSettings,
} from '@taskforceai/api-client/api/account';
import { getBrowserClient } from '@taskforceai/api-client/browserClient';

vi.mock('@taskforceai/api-client/browserClient', () => ({
  getBrowserClient: vi.fn(),
}));

describe('account api', () => {
  const mockClient = {
    currentUser: vi.fn(),
    logout: vi.fn(),
    updateSettings: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    const getBrowserClientMock = getBrowserClient as any;
    getBrowserClientMock.mockReset();
    getBrowserClientMock.mockReturnValue(mockClient);
  });

  describe('fetchCurrentUser', () => {
    it('returns user on success', async () => {
      const mockUser = { email: 'test@example.com' };
      mockClient.currentUser.mockResolvedValue(mockUser);

      const result = await fetchCurrentUser();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(mockUser as any);
      }
    });

    it('returns unauthorized error on 401', async () => {
      mockClient.currentUser.mockRejectedValue({ status: 401 });
      const result = await fetchCurrentUser();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('unauthorized');
      }
    });

    it('returns network error on generic failure', async () => {
      mockClient.currentUser.mockRejectedValue(new Error('Fail'));
      const result = await fetchCurrentUser();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('network');
      }
    });
  });

  describe('logoutUser', () => {
    it('returns true on success', async () => {
      mockClient.logout.mockResolvedValue(undefined);
      const result = await logoutUser();
      expect(result.ok).toBe(true);
    });

    it('returns error on failure', async () => {
      mockClient.logout.mockRejectedValue({ status: 500 });
      const result = await logoutUser();
      expect(result.ok).toBe(false);
    });
  });

  describe('updateUserSettings', () => {
    it('returns true on success', async () => {
      mockClient.updateSettings.mockResolvedValue({ ok: true });
      const result = await updateUserSettings({ theme_preference: 'light' });
      expect(result.ok).toBe(true);
    });

    it('returns error when result.ok is false', async () => {
      mockClient.updateSettings.mockResolvedValue({ ok: false, error: { status: 400 } });
      const result = await updateUserSettings({});
      expect(result.ok).toBe(false);
    });
  });
});
