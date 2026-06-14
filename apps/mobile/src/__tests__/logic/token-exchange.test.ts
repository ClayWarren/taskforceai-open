import { beforeEach, describe, expect, it, mock } from 'bun:test';

const testState = {
  baseUrl: 'https://api.taskforceai.chat',
  fetchImpl: mock(async () =>
    new Response(JSON.stringify({ access_token: 'token-123' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  ),
};

mock.module('../../api/client', () => ({
  getMobilePinnedFetch: () => testState.fetchImpl,
}));

mock.module('../../config/base-url', () => ({
  getMobileBaseUrl: () => testState.baseUrl,
}));

import { exchangeAppleToken, exchangeGoogleToken } from '../../auth/token-exchange';

describe('token exchange uses pinned fetch', () => {
  beforeEach(() => {
    testState.fetchImpl.mockClear();
    testState.fetchImpl.mockImplementation(
      async () =>
        new Response(JSON.stringify({ access_token: 'token-123' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );
  });

  it('exchanges Google token through pinned fetch', async () => {
    const result = await exchangeGoogleToken({
      idToken: 'google-id-token',
      accessToken: 'google-access-token',
    });

    expect(result.accessToken).toBe('token-123');
    expect(testState.fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = testState.fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.taskforceai.chat/api/v1/auth/google');
    expect(init.method).toBe('POST');
  });

  it('exchanges Apple token through pinned fetch', async () => {
    const result = await exchangeAppleToken({
      identityToken: 'apple-identity-token',
      authorizationCode: 'apple-authorization-code',
      email: 'user@example.com',
      fullName: 'User Example',
    });

    expect(result.accessToken).toBe('token-123');
    expect(testState.fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = testState.fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.taskforceai.chat/api/v1/auth/apple');
    expect(init.method).toBe('POST');
  });

  it('returns MFA challenge payloads from provider exchanges', async () => {
    testState.fetchImpl.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            mfa_required: true,
            mfa_token: 'mfa-token-123',
            user: {
              cancel_at_period_end: false,
              code_execution_enabled: true,
              current_period_end: null,
              current_period_start: null,
              customer_id: null,
              disabled: 'false',
              email: 'mfa@example.com',
              free_tasks_remaining: 0,
              full_name: 'MFA User',
              id: 7,
              is_admin: false,
              last_message_timestamp: null,
              memory_enabled: true,
              message_count: 0,
              mfa_enabled: true,
              notifications_enabled: true,
              plan: 'free',
              quick_mode_enabled: true,
              subscription_id: null,
              subscription_source: null,
              subscription_status: null,
              theme_preference: 'dark',
              trust_layer_enabled: false,
              web_search_enabled: true,
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
    );

    const result = await exchangeGoogleToken({
      idToken: 'google-id-token',
      accessToken: 'google-access-token',
    });

    expect(result).toEqual(
      expect.objectContaining({
        mfaRequired: true,
        mfaToken: 'mfa-token-123',
      })
    );
  });

  it('surfaces API error payload message', async () => {
    testState.fetchImpl.mockImplementation(
      async () =>
        new Response(JSON.stringify({ error: 'invalid oauth token' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
    );

    await expect(
      exchangeGoogleToken({
        idToken: 'bad',
        accessToken: 'bad',
      })
    ).rejects.toThrow('invalid oauth token');
  });
});
