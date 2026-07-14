import { describe, expect, it } from 'bun:test';

import { createClientHarness, createJsonResponse, fetchCall } from './client.test-utils';

describe('createApiClient core resources', () => {
  it('lists and upserts scheduled agents', async () => {
    const timestamp = '2026-07-12T12:00:00';
    const scheduledAgent = {
      active_days: [0, 1, 2, 3, 4, 5, 6],
      active_end: '23:59',
      active_start: '00:00',
      autonomy_enabled: true,
      avatar: null,
      check_interval: 600,
      created_at: timestamp,
      description: 'Prepare a daily brief',
      id: 'agent-1',
      last_run_at: null,
      model_id: null,
      name: 'Daily brief',
      next_run_at: null,
      status: 'IDLE',
      timezone: 'America/Chicago',
      updated_at: timestamp,
      user_id: 1,
    };
    const { client, fetchMock } = createClientHarness([
      createJsonResponse([scheduledAgent]),
      createJsonResponse(scheduledAgent),
    ]);

    const listed = await client.listAgents();
    const updated = await client.upsertAgent({
      id: 'agent-1',
      name: 'Daily brief',
      description: 'Prepare a daily brief',
      autonomyEnabled: true,
      timezone: 'America/Chicago',
      activeStart: '00:00',
      activeEnd: '23:59',
      activeDays: [0, 1, 2, 3, 4, 5, 6],
      check_interval: 600,
    });

    expect(listed[0]?.id).toBe('agent-1');
    expect(listed[0]?.last_run_at).toBeNull();
    expect(listed[0]?.next_run_at).toBeNull();
    expect(updated.autonomy_enabled).toBe(true);
    expect(updated.last_run_at).toBeNull();
    expect(updated.next_run_at).toBeNull();
    expect(fetchCall(fetchMock, 0)[0]).toBe('/api/v1/agents');
    expect(fetchCall(fetchMock, 1)[1]?.method).toBe('POST');
  });

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

  it('uploads legacy attachment payloads before submitting attachment ids', async () => {
    const { client, fetchMock } = createClientHarness([
      createJsonResponse({ id: 'att-uri', mime_type: 'text/plain', size: 10 }),
      createJsonResponse({ id: 'att-image', mime_type: 'image/png', size: 5 }),
      createJsonResponse({ id: 'att-audio', mime_type: 'audio/mp3', size: 5 }),
      createJsonResponse({ id: 'att-video', mime_type: 'video/mp4', size: 5 }),
      createJsonResponse({ task_id: 'task-attach', status: 'queued' }),
    ]);

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

    for (let index = 0; index < 4; index += 1) {
      const [url, init] = fetchCall(fetchMock, index);
      expect(url).toBe('/api/v1/attachments/upload');
      expect(init?.method).toBe('POST');
      expect(init?.body).toBeInstanceOf(FormData);
    }

    const [, init] = fetchCall(fetchMock, 4);
    expect(init?.method).toBe('POST');
    const body = init?.body;
    if (typeof body !== 'string') throw new TypeError('expected JSON request body');
    const payload = JSON.parse(body) as Record<string, unknown>;
    expect(payload['attachment_ids']).toEqual(['att-uri', 'att-image', 'att-audio', 'att-video']);
    expect(payload['attachments']).toBeUndefined();
    expect(payload['audio_attachments']).toBeUndefined();
    expect(payload['video_attachments']).toBeUndefined();
  });

  it('rejects UNC-style legacy URI attachments before upload', async () => {
    const cases = [
      'file://server/share/report.txt',
      ' FILE://server/share/report.txt ',
      'file:////server/share/report.txt',
      '\\\\server\\share\\report.txt',
      '  \\\\server\\share\\report.txt  ',
      '//server/share/report.txt',
    ];

    for (const uri of cases) {
      const { client, fetchMock } = createClientHarness(
        createJsonResponse({ id: 'att-uri', mime_type: 'text/plain', size: 10 })
      );

      await expect(
        client.runTask({
          prompt: 'hello',
          attachments: [{ uri, name: 'report.txt' }],
        })
      ).rejects.toThrow('UNC file attachment URIs are not allowed');
      expect(fetchMock).not.toHaveBeenCalled();
    }
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
    expect(payload['attachments']).toBeUndefined();
  });

  it('adds idempotency key header for JSON run task requests after attachment upload', async () => {
    const { client, fetchMock } = createClientHarness([
      createJsonResponse({ id: 'att-uri', mime_type: 'text/plain', size: 10 }),
      createJsonResponse({ task_id: 'task-attach', status: 'queued' }),
    ]);

    await client.runTask({
      prompt: 'hello',
      attachments: [{ uri: 'file:///report.txt', name: 'report.txt' }],
      options: { idempotencyKey: 'idem-form-1' },
    });

    const [, init] = fetchCall(fetchMock, 1);
    const headers = new Headers(init?.headers);
    expect(headers.get('Idempotency-Key')).toBe('idem-form-1');
    const body = init?.body;
    if (typeof body !== 'string') throw new TypeError('expected JSON request body');
    const payload = JSON.parse(body) as Record<string, unknown>;
    expect(payload['attachment_ids']).toEqual(['att-uri']);
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

  it('rejects UNC-style React Native uploadAttachment URIs before upload', async () => {
    const { client, fetchMock } = createClientHarness(
      createJsonResponse({ id: 'att-uri', mime_type: 'text/plain', size: 10 })
    );

    await expect(
      client.uploadAttachment({
        uri: 'file://server/share/report.txt',
        name: 'report.txt',
      })
    ).rejects.toThrow('UNC file attachment URIs are not allowed');
    expect(fetchMock).not.toHaveBeenCalled();
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
});
