import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';

const browserClient = {
  currentUser: mock(),
  logout: mock(),
  updateSettings: mock(),
};
let activeBrowserClient = browserClient;

mock.module('@taskforceai/api-client/browserClient', () => ({
  getBrowserClient: mock(() => activeBrowserClient),
}));

mock.module('../auth/csrf', () => ({
  getCsrfToken: vi.fn(async () => 'csrf-token'),
}));

mock.module('../auth/logger', () => ({
  getAuthLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

const { fetchCurrentUser, loginUser, logoutUser, registerUser, updateUserSettings } = (await import(
  `./account?test=${Date.now()}`
)) as typeof import('./account');

describe('account', () => {
  beforeEach(() => {
    browserClient.currentUser.mockReset();
    browserClient.logout.mockReset();
    browserClient.updateSettings.mockReset();
    activeBrowserClient = browserClient;
  });

  describe('loginUser', () => {
    it('returns unauthorized error', async () => {
      const result = await loginUser({});
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('unauthorized');
        expect(result.error.message).toBe('Direct login is disabled.');
      }
    });
  });

  describe('registerUser', () => {
    it('returns server error', async () => {
      const result = await registerUser({});
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('server');
        expect(result.error.message).toBe('Direct registration is disabled.');
      }
    });
  });

  it('fetches the current user through the browser client', async () => {
    const user = {
      id: 1,
      email: 'test@example.com',
      full_name: 'Test User',
      plan: 'free',
      message_count: 0,
      free_tasks_remaining: 0,
      last_message_timestamp: null,
      subscription_id: null,
      subscription_status: null,
      subscription_source: null,
      current_period_start: null,
      current_period_end: null,
      cancel_at_period_end: false,
      theme_preference: 'system',
      memory_enabled: true,
      web_search_enabled: true,
      code_execution_enabled: true,
      notifications_enabled: true,
      trust_layer_enabled: true,
      quick_mode_enabled: true,
      customer_id: null,
      disabled: 'false',
      is_admin: false,
      trial_ends_at: null,
    };
    browserClient.currentUser.mockResolvedValue(user);

    const result = await fetchCurrentUser();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.email).toBe('test@example.com');
    }
  });

  it('maps browser client failures to account errors', async () => {
    browserClient.currentUser.mockRejectedValue({ status: 404 });

    const result = await fetchCurrentUser();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('not_found');
      expect(result.error.status).toBe(404);
    }
  });

  it('logs server-side profile failures as errors', async () => {
    browserClient.currentUser.mockRejectedValue({ status: 500 });

    const result = await fetchCurrentUser();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('server');
      expect(result.error.status).toBe(500);
    }
  });

  it('maps transient profile fetch failures to network errors', async () => {
    browserClient.currentUser.mockRejectedValue(new Error('offline'));

    const result = await fetchCurrentUser();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('network');
    }
  });

  it('logs out through the browser client', async () => {
    browserClient.logout.mockResolvedValue(undefined);

    const result = await logoutUser();

    expect(result).toEqual({ ok: true, value: true });
    expect(browserClient.logout).toHaveBeenCalled();
  });

  it('returns an account error when logout fails', async () => {
    browserClient.logout.mockRejectedValue(
      Object.assign(new Error('session expired'), { status: 401 })
    );

    const result = await logoutUser();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('unauthorized');
      expect(result.error.status).toBe(401);
    }
  });

  it('updates user settings when the client returns ok', async () => {
    browserClient.updateSettings.mockResolvedValue({ ok: true, value: { success: true } });

    const result = await updateUserSettings({ full_name: 'Updated User' });

    expect(result).toEqual({ ok: true, value: true });
    expect(browserClient.updateSettings).toHaveBeenCalledWith({ full_name: 'Updated User' });
  });

  it('returns an account error when settings update fails', async () => {
    browserClient.updateSettings.mockResolvedValue({
      ok: false,
      error: Object.assign(new Error('nope'), { status: 500 }),
    });

    const result = await updateUserSettings({ memory_enabled: false });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('server');
      expect(result.error.status).toBe(500);
    }
  });
});
