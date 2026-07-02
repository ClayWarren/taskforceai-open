import { describe, expect, it, vi } from 'bun:test';

import {
  createClientHarness,
  createJsonResponse,
  createUserPayload,
  fetchCall,
} from './client.test-utils';
import * as attachments from './attachments';
import { ApiClientError } from './client';
import type { createApiClient } from './client';

describe('createApiClient', () => {
  it('attaches authorization headers and builds URLs', async () => {
    const { client, fetchMock } = createClientHarness(
      createJsonResponse({
        conversations: [],
        total: 0,
        limit: 50,
        offset: 0,
        has_more: false,
      }),
      {
        baseUrl: 'https://api.example.com/',
        getToken: () => ({ ok: true, value: 'token-123' }),
      }
    );

    await client.getConversations();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchCall(fetchMock);
    expect(url).toBe('https://api.example.com/api/v1/conversations?limit=50');
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer token-123');
  });

  it('sends JSON bodies and parses responses', async () => {
    const { client, fetchMock } = createClientHarness(
      createJsonResponse({
        task_id: 'task-1',
        status: 'completed',
        result: 'done',
        conversation_id: 42,
        trace_id: 'trace-task-1',
      })
    );

    const result = await client.runTask({ prompt: 'hello' });
    expect(result.task_id).toBe('task-1');
    expect(result.status).toBe('completed');
    expect(result.result).toBe('done');
    expect(result.conversation_id).toBe(42);
    expect(result.trace_id).toBe('trace-task-1');

    const [, init] = fetchCall(fetchMock);
    expect(init?.method).toBe('POST');
    const headers = new Headers(init?.headers);
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(init?.body).toBe(JSON.stringify({ prompt: 'hello' }));
  });

  it('adds idempotency key header for JSON run task requests when provided', async () => {
    const { client, fetchMock } = createClientHarness(
      createJsonResponse({ task_id: 'task-1', status: 'queued' })
    );

    await client.runTask({
      prompt: 'hello',
      options: { idempotencyKey: 'idem-json-1' },
    });

    const [, init] = fetchCall(fetchMock);
    const headers = new Headers(init?.headers);
    expect(headers.get('Idempotency-Key')).toBe('idem-json-1');
  });

  it('cancels tasks with a POST request', async () => {
    const { client, fetchMock } = createClientHarness(
      createJsonResponse({ task_id: 'task-1', status: 'canceled' })
    );

    const result = await client.cancelTask('task-1');

    expect(result.status).toBe('canceled');
    const [url, init] = fetchCall(fetchMock);
    expect(url).toBe('/api/v1/tasks/task-1/cancel');
    expect(init?.method).toBe('POST');
  });

  it('lists, creates, updates, and deletes memories', async () => {
    const { client, fetchMock } = createClientHarness([
      createJsonResponse([
        {
          id: 1,
          content: 'User prefers concise updates',
          type: 'preference',
          metadata: null,
          created_at: '2026-06-04T19:00:00Z',
          updated_at: '2026-06-04T20:00:00Z',
        },
      ]),
      new Response(null, { status: 204 }),
      createJsonResponse({
        id: 1,
        content: 'User prefers terse updates',
        type: 'preference',
        metadata: null,
        created_at: '2026-06-04T19:00:00Z',
        updated_at: '2026-06-04T21:00:00Z',
      }),
      new Response(null, { status: 204 }),
    ]);

    const memories = await client.listMemories();
    await client.createMemory({ content: 'User works in TaskForceAI', type: 'fact' });
    const updated = await client.updateMemory(1, {
      content: 'User prefers terse updates',
      type: 'preference',
    });
    await client.deleteMemory(1);

    expect(memories[0]?.content).toBe('User prefers concise updates');
    expect(updated.content).toBe('User prefers terse updates');
    expect(fetchCall(fetchMock, 0)[0]).toBe('/api/v1/memories');

    const [createUrl, createInit] = fetchCall(fetchMock, 1);
    expect(createUrl).toBe('/api/v1/memories');
    expect(createInit?.method).toBe('POST');
    expect(createInit?.body).toBe(
      JSON.stringify({ content: 'User works in TaskForceAI', type: 'fact' })
    );

    const [updateUrl, updateInit] = fetchCall(fetchMock, 2);
    expect(updateUrl).toBe('/api/v1/memories/1');
    expect(updateInit?.method).toBe('PATCH');
    expect(updateInit?.body).toBe(
      JSON.stringify({ content: 'User prefers terse updates', type: 'preference' })
    );

    const [deleteUrl, deleteInit] = fetchCall(fetchMock, 3);
    expect(deleteUrl).toBe('/api/v1/memories/1');
    expect(deleteInit?.method).toBe('DELETE');
  });

  it('validates memory request payloads before sending them', async () => {
    const { client, fetchMock } = createClientHarness(new Response(null, { status: 204 }));

    await expect(client.createMemory({ content: '', type: 'fact' } as any)).rejects.toThrow();
    await expect(
      client.updateMemory(1, { content: '', type: 'preference' } as any)
    ).rejects.toThrow();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('validates memory path ids before sending update and delete requests', async () => {
    const { client, fetchMock } = createClientHarness(new Response(null, { status: 204 }));

    await expect(client.updateMemory(0, { content: 'Valid memory', type: 'fact' })).rejects.toThrow(
      'memory id must be a positive integer'
    );
    await expect(client.deleteMemory(Number.NaN)).rejects.toThrow(
      'memory id must be a positive integer'
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects invalid memory response payloads', async () => {
    const { client } = createClientHarness(
      createJsonResponse({
        id: 'not-a-number',
        content: 'User prefers concise updates',
        type: 'preference',
        created_at: '2026-06-04T19:00:00Z',
        updated_at: '2026-06-04T20:00:00Z',
      })
    );

    await expect(
      client.updateMemory(1, { content: 'User prefers terse updates', type: 'preference' })
    ).rejects.toThrow();
  });

  it('rejects invalid memory list response payloads', async () => {
    const { client } = createClientHarness(
      createJsonResponse([
        {
          id: 1,
          content: 'User prefers concise updates',
          type: 'preference',
          created_at: '2026-06-04T19:00:00Z',
          updated_at: 42,
        },
      ])
    );

    await expect(client.listMemories()).rejects.toThrow();
  });

  it('uses multipart payloads when attachments are provided', async () => {
    const { client, fetchMock } = createClientHarness(
      createJsonResponse({ task_id: 'task-attach', status: 'queued' })
    );
    const formData = new FormData();
    const buildFormSpy = vi.spyOn(attachments, 'buildRunFormData').mockReturnValue(formData);

    await client.runTask({
      prompt: 'hello',
      attachments: [
        { uri: 'file:///report.txt', name: 'report.txt' },
        { data: 'aGVsbG8=', mime_type: 'image/png', name: 'proof.png' },
      ],
      audio_attachments: [{ data: 'YXVkaW8=', format: 'mp3', name: 'audio.mp3' }],
      video_attachments: [{ data: 'dmlkZW8=', mime_type: 'video/mp4', name: 'clip.mp4' }],
      conversation_id: 'conv-1',
      modelId: 'model-x',
      projectId: 7,
      role_models: { planner: 'gpt-5', coder: 'gpt-4.1' },
      options: { computerUseEnabled: true, max_steps: 5 },
      demo: true,
    });

    expect(buildFormSpy).toHaveBeenCalledWith(
      {
        prompt: 'hello',
        conversation_id: 'conv-1',
        modelId: 'model-x',
        projectId: 7,
        demo: true,
        role_models: { planner: 'gpt-5', coder: 'gpt-4.1' },
        attachments: [{ data: 'aGVsbG8=', mime_type: 'image/png', name: 'proof.png' }],
        audio_attachments: [{ data: 'YXVkaW8=', format: 'mp3', name: 'audio.mp3' }],
        video_attachments: [{ data: 'dmlkZW8=', mime_type: 'video/mp4', name: 'clip.mp4' }],
        options: { computerUseEnabled: true, max_steps: 5 },
      },
      [{ uri: 'file:///report.txt', name: 'report.txt' }]
    );

    const [, init] = fetchCall(fetchMock);
    expect(init?.body).toBe(formData);
  });

  it('ignores malformed non-array attachments payloads without throwing', async () => {
    const { client, fetchMock } = createClientHarness(
      createJsonResponse({ task_id: 'task-1', status: 'queued' })
    );

    const result = await client.runTask({
      prompt: 'hello',
      attachments: { uri: 'file://report.txt', name: 'report.txt' },
    } as unknown as Parameters<typeof client.runTask>[0]);

    expect(result.task_id).toBe('task-1');

    const [, init] = fetchCall(fetchMock);
    expect(init?.method).toBe('POST');
    const payload = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<
      string,
      unknown
    >;
    expect(payload['prompt']).toBe('hello');
    expect(payload['attachments']).toEqual({ uri: 'file://report.txt', name: 'report.txt' });
  });

  it('adds idempotency key header for multipart run task requests when provided', async () => {
    const { client, fetchMock } = createClientHarness(
      createJsonResponse({ task_id: 'task-attach', status: 'queued' })
    );
    const formData = new FormData();
    const buildFormSpy = vi.spyOn(attachments, 'buildRunFormData').mockReturnValue(formData);
    buildFormSpy.mockClear();

    await client.runTask({
      prompt: 'hello',
      attachments: [{ uri: 'file:///report.txt', name: 'report.txt' }],
      options: { idempotencyKey: 'idem-form-1' },
    });

    const [, init] = fetchCall(fetchMock);
    const headers = new Headers(init?.headers);
    expect(headers.get('Idempotency-Key')).toBe('idem-form-1');
    expect(buildFormSpy).toHaveBeenCalledTimes(1);
  });

  it('fetches execution traces and uploads attachments', async () => {
    const traceResponse = {
      trace: {
        id: 'trace-1',
        task_id: 'task-1',
        goal: 'Ship it',
        plan: {},
        steps: [],
        self_eval: {},
        artifacts: [],
        created_at: '2026-01-01T00:00:00Z',
      },
    };
    const uploadResponse = { id: 'file-1', mime_type: 'text/plain', size: 5 };
    const { client, fetchMock } = createClientHarness([
      createJsonResponse(traceResponse),
      createJsonResponse(uploadResponse),
    ]);

    const trace = await client.getExecutionTrace('task/one?debug=true');
    const uploaded = await client.uploadAttachment(new Blob(['hello'], { type: 'text/plain' }));

    expect(trace.trace.id).toBe('trace-1');
    expect(uploaded.id).toBe('file-1');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/tasks/task%2Fone%3Fdebug%3Dtrue/trace');
    const uploadCall = fetchCall(fetchMock, 1);
    expect(uploadCall[0]).toBe('/api/v1/attachments/upload');
    expect(uploadCall[1]?.method).toBe('POST');
    expect(uploadCall[1]?.body).toBeInstanceOf(FormData);
  });

  it('lists active tasks and submits approval decisions', async () => {
    const activeTasksResponse = {
      tasks: [
        {
          task_id: 'task-1',
          status: 'awaiting_approval',
          prompt: 'Ship desktop flow',
          source: 'desktop',
          pending_approval: {
            permission: 'command',
            agent_name: 'Desktop',
            patterns: ['bun test'],
            metadata: {},
          },
        },
      ],
    };
    const { client, fetchMock } = createClientHarness([
      createJsonResponse(activeTasksResponse),
      new Response('Decision sent', { status: 200 }),
    ]);

    const activeTasks = await client.listActiveTasks(10);
    const approval = await client.approveTask('task-1', { approved: true });

    expect(activeTasks.tasks[0]?.source).toBe('desktop');
    expect(approval).toBe('Decision sent');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/tasks/active?limit=10');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/v1/tasks/task-1/approve');
  });

  it('returns empty conversations when the API responds with no content', async () => {
    const { client } = createClientHarness(new Response(null, { status: 204 }));

    const conversations = await client.getConversations();
    expect(conversations).toEqual([]);
  });

  it('returns a paginated conversations page for sidebar backfill', async () => {
    const { client, fetchMock } = createClientHarness(
      createJsonResponse({
        conversations: [
          {
            id: 42,
            timestamp: '2026-01-01T00:00:00.000Z',
            user_input: 'Old prompt',
            result: 'Old answer',
          },
        ],
        total: 2,
        limit: 20,
        offset: 20,
        has_more: false,
      }),
      {
        getToken: () => ({ ok: true, value: 'conversation-token' }),
      }
    );

    const page = await client.getConversationsPage(20, 20);

    expect(page.conversations[0]?.id).toBe(42);
    expect(page.has_more).toBe(false);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/conversations?limit=20&offset=20');
    const headers = new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers);
    expect(headers.get('Authorization')).toBe('Bearer conversation-token');
  });

  it('omits non-positive conversation query params', async () => {
    const { client, fetchMock } = createClientHarness(
      createJsonResponse({
        conversations: [],
        total: 0,
        limit: 0,
        offset: 0,
        has_more: false,
      })
    );

    await client.getConversations(0, 0);

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/conversations');
  });

  it('supports conversation sharing and message feedback', async () => {
    const { client, fetchMock } = createClientHarness([
      createJsonResponse({
        share_id: 'share-1',
        is_public: true,
        url: 'https://taskforceai.example/share/share-1',
      }),
      new Response(null, { status: 204 }),
    ]);

    const share = await client.shareConversation(7, true);
    await client.submitMessageFeedback('msg/one?debug=true', -1);

    expect(share.share_id).toBe('share-1');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/conversations/7/share');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/v1/messages/msg%2Fone%3Fdebug%3Dtrue/feedback');
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.body).toBe(
      JSON.stringify({ rating: -1 })
    );
  });

  it('rejects invalid conversation path IDs before fetching', async () => {
    const { client, fetchMock } = createClientHarness([]);

    expect(() => client.deleteConversation(0)).toThrow(
      'Conversation ID must be a positive integer'
    );
    expect(() => client.shareConversation(Number.NaN, true)).toThrow(
      'Conversation ID must be a positive integer'
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

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

  it('loads developer storage summaries', async () => {
    const { client, fetchMock } = createClientHarness(
      createJsonResponse({
        usedBytes: 19_000_000,
        quotaBytes: 40_000_000_000,
        categories: [
          { id: 'files', label: 'Files', bytes: 105_000, count: 1 },
          { id: 'images', label: 'Images', bytes: 18_900_000, count: 45 },
        ],
      })
    );

    const summary = await client.getStorageSummary();

    expect(summary.quotaBytes).toBe(40_000_000_000);
    expect(summary.categories[1]?.label).toBe('Images');
    const [url, init] = fetchCall(fetchMock);
    expect(url).toBe('/api/v1/developer/storage');
    expect(init?.method).toBe('GET');
  });

  it('syncs mobile subscriptions', async () => {
    const { client } = createClientHarness(
      createJsonResponse({
        plan: 'free',
        subscription_status: null,
        subscription_source: 'stripe',
        current_period_end: null,
      })
    );

    const result = await client.syncMobileSubscription();
    expect(result.plan).toBe('free');
  });

  it('supports projects and integrations endpoints', async () => {
    const project = {
      id: 1,
      name: 'Launch',
      description: null,
      custom_instructions: null,
      created_at: '2026-01-01T00:00:00Z',
    };
    const { client, fetchMock } = createClientHarness([
      createJsonResponse([project]),
      createJsonResponse(project),
      new Response(null, { status: 204 }),
      createJsonResponse([{ id: 'github', provider: 'github', connected: true }]),
      new Response(null, { status: 204 }),
    ]);

    const projects = await client.getProjects();
    const created = await client.createProject({ name: 'Launch' });
    await client.deleteProject(1);
    const integrations = await client.getIntegrations();
    await client.disconnectIntegration('github/team?debug=true');

    expect(projects).toHaveLength(1);
    expect(created.id).toBe(1);
    expect(integrations[0]?.provider).toBe('github');
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/v1/projects/1');
    expect(fetchMock.mock.calls[4]?.[0]).toBe('/api/v1/integrations/github%2Fteam%3Fdebug%3Dtrue');
  });

  it('rejects invalid project path IDs before fetching', async () => {
    const { client, fetchMock } = createClientHarness([]);

    expect(() => client.deleteProject(0)).toThrow('Project ID must be a positive integer');
    expect(() => client.deleteProject(Number.POSITIVE_INFINITY)).toThrow(
      'Project ID must be a positive integer'
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('registers and unregisters push tokens', async () => {
    const { client, fetchMock } = createClientHarness([
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
    ]);

    await client.registerPushToken({ token: 'push-1', platform: 'web' });
    await client.unregisterPushToken('push-1');

    const registerCall = fetchCall(fetchMock);
    const [registerUrl, registerInit] = registerCall;
    expect(registerUrl).toBe('/api/v1/notifications/push-tokens');
    expect(registerInit?.method).toBe('POST');
    expect(registerInit?.body).toBe(JSON.stringify({ token: 'push-1', platform: 'web' }));

    const unregisterCall = fetchCall(fetchMock, 1);
    const [unregisterUrl, unregisterInit] = unregisterCall;
    expect(unregisterUrl).toBe('/api/v1/notifications/push-tokens');
    expect(unregisterInit?.method).toBe('DELETE');
    expect(unregisterInit?.body).toBe(JSON.stringify({ token: 'push-1' }));
  });

  it('supports GDPR export and delete account', async () => {
    const { client, fetchMock } = createClientHarness([
      new Response('export-data', { status: 200 }),
      new Response(null, { status: 204 }),
    ]);

    const exported = await client.exportGdprData();
    await client.deleteAccount({ confirmEmail: 'demo@example.com' });

    expect(exported).toBe('export-data');

    const deleteCall = fetchCall(fetchMock, 1);
    const [, deleteInit] = deleteCall;
    expect(deleteInit?.method).toBe('POST');
    expect(deleteInit?.body).toBe(JSON.stringify({ confirmEmail: 'demo@example.com' }));
  });

  it('supports finance dashboard and financial memories', async () => {
    const financeResponse = {
      connected_accounts: false,
      provider_status: 'not_connected',
      memories: [{ id: 1, content: 'Saving for a house', type: 'finance' }],
      capabilities: ['goal_planning'],
      connections: [],
      accounts: [],
      recent_transactions: [],
      recurring_streams: [],
      privacy: {
        connected_accounts_available: false,
        can_mutate_accounts: false,
        training_controls: 'uses account-level data controls',
        data_controls: ['financial memories can be deleted at any time'],
      },
    };
    const { client, fetchMock } = createClientHarness([
      createJsonResponse(financeResponse),
      new Response(null, { status: 204 }),
      createJsonResponse({ link_token: 'link-sandbox', expiration: '2026-06-06T20:00:00Z' }),
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
    ]);

    const dashboard = await client.getFinanceDashboard();
    await client.createFinanceMemory({ content: 'Saving for a house' });
    const linkToken = await client.createFinanceLinkToken();
    await client.exchangeFinancePublicToken({ public_token: 'public-sandbox' });
    await client.syncFinanceData();
    await client.disconnectFinanceConnection(2);
    await client.deleteFinanceMemory(1);

    expect(dashboard.memories[0]?.content).toBe('Saving for a house');
    expect(linkToken.link_token).toBe('link-sandbox');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/finances');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/v1/finances/memories');
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/v1/finances/link-token');
    expect(fetchMock.mock.calls[3]?.[0]).toBe('/api/v1/finances/exchange-public-token');
    expect(fetchMock.mock.calls[4]?.[0]).toBe('/api/v1/finances/sync');
    expect(fetchMock.mock.calls[5]?.[0]).toBe('/api/v1/finances/connections/2');
    expect(fetchMock.mock.calls[6]?.[0]).toBe('/api/v1/finances/memories/1');
  });

  it('validates finance path ids before sending delete requests', async () => {
    const { client, fetchMock } = createClientHarness(new Response(null, { status: 204 }));

    await expect(client.disconnectFinanceConnection(0)).rejects.toThrow(
      'finance connection id must be a positive integer'
    );
    await expect(client.deleteFinanceMemory(Number.NaN)).rejects.toThrow(
      'finance memory id must be a positive integer'
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('validates finance mutation payloads before sending requests', async () => {
    const { client, fetchMock } = createClientHarness(new Response(null, { status: 204 }));

    expect(() => client.createFinanceMemory({ content: '' })).toThrow();
    expect(() => client.exchangeFinancePublicToken({ public_token: '' })).toThrow();

    expect(fetchMock).not.toHaveBeenCalled();
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
