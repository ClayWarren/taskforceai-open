import { describe, expect, it } from 'bun:test';

import {
  createClientHarness,
  createJsonResponse,
  createUserPayload,
  fetchCall,
} from './client.test-utils';
import { ApiClientError } from './client';
import type { createApiClient } from './client';

describe('createApiClient account and billing', () => {
  it('returns model selector options', async () => {
    const { client } = createClientHarness(
      createJsonResponse({
        enabled: true,
        options: [{ id: 'model-1', label: 'Model 1', badge: 'fast' }],
        defaultModelId: 'model-1',
      })
    );

    const modelOptions = await client.getModelOptions();
    expect(modelOptions.enabled).toBe(true);
    expect(modelOptions.defaultModelId).toBe('model-1');
  });

  it('throws ApiClientError with parsed details', async () => {
    const { client } = createClientHarness(
      createJsonResponse({ detail: 'Not authorised' }, { status: 401, statusText: 'Unauthorized' })
    );

    await expect(client.getConversations()).rejects.toMatchObject({
      status: 401,
      message: 'Not authorised',
    });
  });

  it('applies object tokens, supports 204/parseJson=false, and ignores logout 404', async () => {
    const responses = [
      new Response(null, { status: 204 }),
      new Response(null, { status: 404, statusText: 'Not Found' }),
    ];
    const { client, fetchMock } = createClientHarness(responses, {
      getToken: () => ({ ok: true, value: { access_token: 'obj-token' } }),
    });

    await client.deleteConversation(7);
    await client.logout();

    const deleteCall = fetchMock.mock.calls[0];
    const logoutCall = fetchMock.mock.calls[1];
    expect(deleteCall?.[0]).toBe('/api/v1/conversations/7');
    expect(logoutCall?.[0]).toBe('/api/v1/auth/logout');

    const headers = new Headers((deleteCall?.[1] as RequestInit | undefined)?.headers);
    expect(headers.get('Authorization')).toBe('Bearer obj-token');
  });

  it('supports current user and settings updates', async () => {
    const user = createUserPayload({
      subscription_source: null,
      theme_preference: 'system',
      trust_layer_enabled: true,
    });
    const { client, fetchMock } = createClientHarness([
      createJsonResponse(user),
      createJsonResponse({ success: true }),
    ]);

    const currentUser = await client.currentUser();
    const updateResult = await client.updateSettings({ full_name: 'Updated' });

    expect(currentUser.email).toBe('test@example.com');
    expect(updateResult.ok).toBe(true);
    if (updateResult.ok) {
      expect(updateResult.value).toEqual({ success: true });
    }
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/auth/me');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/v1/auth/settings');
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.method).toBe('PUT');
  });

  it('handles authenticator MFA setup, verification, disable, and login payloads', async () => {
    const { client, fetchMock } = createClientHarness([
      createJsonResponse({ authenticator_app_enabled: false }),
      createJsonResponse({
        authenticator_app_enabled: false,
        secret: 'secret-123',
        otpauth_uri: 'otpauth://totp/TaskForceAI:test@example.com?secret=secret-123',
      }),
      createJsonResponse({ authenticator_app_enabled: true }),
      createJsonResponse({ authenticator_app_enabled: false }),
      createJsonResponse({ success: false }),
      createJsonResponse({
        success: true,
        redirect_url: '/app',
        access_token: 'mfa-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
      }),
    ]);

    const status = await client.getMFAStatus();
    const setup = await client.setupAuthenticatorMFA();
    const verified = await client.verifyAuthenticatorMFA('123456');
    const disabled = await client.disableAuthenticatorMFA('654321');
    const loginWithoutToken = await client.verifyAuthenticatorMFALogin('111111');
    const loginWithToken = await client.verifyAuthenticatorMFALogin('222222', 'mfa-token');

    expect(status.authenticator_app_enabled).toBe(false);
    expect(setup.secret).toBe('secret-123');
    expect(verified.authenticator_app_enabled).toBe(true);
    expect(disabled.authenticator_app_enabled).toBe(false);
    expect(loginWithoutToken).toEqual({ success: false });
    expect(loginWithToken.access_token).toBe('mfa-access-token');

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/v1/auth/mfa',
      '/api/v1/auth/mfa/authenticator/setup',
      '/api/v1/auth/mfa/authenticator/verify',
      '/api/v1/auth/mfa/authenticator',
      '/api/v1/auth/mfa/authenticator/login',
      '/api/v1/auth/mfa/authenticator/login',
    ]);

    const disableInit = fetchMock.mock.calls[3]?.[1] as RequestInit | undefined;
    expect(disableInit?.method).toBe('DELETE');
    expect(new Headers(disableInit?.headers).get('Content-Type')).toBe('application/json');
    expect(disableInit?.body).toBe(JSON.stringify({ code: '654321' }));

    const loginWithoutTokenInit = fetchMock.mock.calls[4]?.[1] as RequestInit | undefined;
    const loginWithTokenInit = fetchMock.mock.calls[5]?.[1] as RequestInit | undefined;
    expect(loginWithoutTokenInit?.body).toBe(JSON.stringify({ code: '111111' }));
    expect(loginWithTokenInit?.body).toBe(
      JSON.stringify({ code: '222222', mfa_token: 'mfa-token' })
    );
  });

  it('returns Err when settings responses fail schema validation', async () => {
    const { client } = createClientHarness(createJsonResponse({ success: 1 }));

    const result = await client.updateSettings({ full_name: 'Updated' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('expected boolean');
    }
  });

  it('throws on logout failures other than 404', async () => {
    const { client } = createClientHarness(
      createJsonResponse({ detail: 'Server error' }, { status: 500, statusText: 'Server Error' })
    );

    await expect(client.logout()).rejects.toBeInstanceOf(ApiClientError);
  });

  it('handles subscription and product endpoints', async () => {
    const { client, fetchMock } = createClientHarness([
      createJsonResponse({
        subscription: {
          subscription_id: 'sub-1',
          status: 'active',
          current_period_start: 1,
          current_period_end: 2,
          cancel_at_period_end: false,
        },
      }),
      createJsonResponse({
        products: [
          {
            id: 'prod-1',
            name: 'Pro',
            description: null,
            plan: 'pro',
            price_id: 'price-1',
            price_amount: 20,
            price_currency: 'USD',
          },
        ],
      }),
      createJsonResponse({
        checkout_url: 'https://checkout.example.com',
        subscription_id: 'sub-2',
        status: 'pending',
      }),
    ]);

    const subscription = await client.getSubscription();
    const products = await client.getProducts();
    const created = await client.createSubscription('price-123');

    expect(subscription.subscription?.subscription_id).toBe('sub-1');
    expect(products.products).toHaveLength(1);
    expect(created.checkout_url).toBe('https://checkout.example.com');

    const createCall = fetchCall(fetchMock, 2);
    const [, init] = createCall;
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ price_id: 'price-123' }));
  });

  it('normalizes billing payloads from snake_case wire format', async () => {
    const balancePayload = {
      credit_balance: 19.75,
      auto_recharge_enabled: true,
      auto_recharge_amount: 25,
      auto_recharge_threshold: 5,
      subscription_status: 'active',
      subscription_id: 'sub_123',
      cancel_at_period_end: false,
      current_period_end: '2026-03-01T00:00:00Z',
      current_period_start: '2026-02-01T00:00:00Z',
    };

    const responses = [
      createJsonResponse(balancePayload),
      createJsonResponse([
        {
          id: 'pm_1',
          brand: 'visa',
          last4: '4242',
          exp_month: 12,
          exp_year: 2030,
          is_default: true,
        },
      ]),
      createJsonResponse([
        {
          id: 'in_1',
          number: 'INV-1',
          amount_paid: 12.5,
          currency: 'usd',
          status: 'paid',
          created_at: '2026-03-02T00:00:00Z',
          invoice_pdf: 'https://billing.example.com/inv.pdf',
          hosted_url: 'https://billing.example.com/inv',
        },
      ]),
      createJsonResponse(balancePayload),
      createJsonResponse({ url: 'https://billing.example.com/portal' }),
    ];

    const { client, fetchMock } = createClientHarness(responses);

    const balance = await client.getBalance();
    expect(balance.creditBalance).toBe(19.75);
    expect(balance.autoRechargeEnabled).toBe(true);
    expect(balance.currentPeriodEnd).toBe(Math.trunc(Date.parse('2026-03-01T00:00:00Z') / 1000));

    const methods = await client.getPaymentMethods();
    expect(methods[0]?.expMonth).toBe(12);
    expect(methods[0]?.isDefault).toBe(true);

    const invoices = await client.getInvoices();
    expect(invoices[0]?.amountPaid).toBe(12.5);
    expect(invoices[0]?.createdAt).toBe(Math.trunc(Date.parse('2026-03-02T00:00:00Z') / 1000));
    expect(invoices[0]?.invoicePdf).toBe('https://billing.example.com/inv.pdf');

    const updated = await client.updateAutoRecharge({ enabled: true, amount: 25, threshold: 5 });
    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.value.subscriptionId).toBe('sub_123');
    }
    const updateCall = fetchCall(fetchMock, 3);
    const [, updateInit] = updateCall;
    const updateHeaders = new Headers(updateInit?.headers);
    expect(updateHeaders.get('Content-Type')).toBe('application/json');

    const portal = await client.createPortalSession();
    expect(portal.ok).toBe(true);
    if (portal.ok) {
      expect(portal.value.url).toBe('https://billing.example.com/portal');
    }
  });

  describe('refactored methods returning Result', () => {
    const mockMessageResponse = { message: 'Success' };
    const methods = [
      {
        name: 'updateTheme',
        invoke: (client: ReturnType<typeof createApiClient>) => client.updateTheme('light'),
        emptyInvoke: (client: ReturnType<typeof createApiClient>) => client.updateTheme('dark'),
        error: 'Error',
      },
      {
        name: 'upgradePlan',
        invoke: (client: ReturnType<typeof createApiClient>) => client.upgradePlan('pro'),
        error: 'Upgrade failed',
      },
      {
        name: 'cancelSubscription',
        invoke: (client: ReturnType<typeof createApiClient>) => client.cancelSubscription(),
        error: 'Cancel failed',
      },
      {
        name: 'reactivateSubscription',
        invoke: (client: ReturnType<typeof createApiClient>) => client.reactivateSubscription(),
        error: 'Reactivate failed',
      },
    ];

    for (const method of methods) {
      it(`${method.name} returns Ok result on success`, async () => {
        const { client } = createClientHarness(createJsonResponse(mockMessageResponse));

        const result = await method.invoke(client);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value).toEqual(mockMessageResponse);
        }
      });

      it(`${method.name} returns Err result on failure`, async () => {
        const { client } = createClientHarness(
          createJsonResponse({ detail: method.error }, { status: 400, statusText: 'Bad Request' })
        );

        const result = await method.invoke(client);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.message).toBe(method.error);
        }
      });

      it(`${method.name} returns Err when parseOptional returns undefined`, async () => {
        const { client } = createClientHarness(new Response(null, { status: 204 }));

        const result = await (method.emptyInvoke ?? method.invoke)(client);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.message).toBe('No response data');
        }
      });
    }
  });

  describe('register method', () => {
    it('registers a new user', async () => {
      const mockUser = createUserPayload();
      const { client, fetchMock } = createClientHarness(createJsonResponse(mockUser));

      const result = await client.register({
        email: 'test@example.com',
        full_name: 'Test User',
      });

      expect(result.email).toBe('test@example.com');
      expect(result.full_name).toBe('Test User');

      const [url, init] = fetchCall(fetchMock);
      expect(url).toBe('/api/v1/auth/register');
      expect(init?.method).toBe('POST');
    });
  });
});
