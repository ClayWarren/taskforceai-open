import { describe, expect, it } from 'bun:test';

import {
  createClient,
  createMockResponse,
  installFetchMock,
  installFetchResponses,
  requestFromCall,
  TaskForceAI,
} from '../test/index-test-helpers';

describe('TaskForceAI thread and file endpoint methods', () => {
  it('calls thread endpoints with expected URLs and methods', async () => {
    const thread = {
      id: 10,
      timestamp: '2026-01-01T00:00:00Z',
      user_input: 'Thread 1',
      result: '',
      execution_time: 0,
      model: '',
      agent_count: 0,
      sources: [],
      agentStatuses: [],
      toolEvents: [],
    };
    const fetchMock = installFetchResponses(
      createMockResponse(thread),
      createMockResponse({
        conversations: [],
        total: 0,
        limit: 20,
        offset: 0,
        has_more: false,
      }),
      createMockResponse(thread),
      createMockResponse({ messages: [], truncated: false }),
      createMockResponse({ taskId: 'task_in_thread', status: 'processing' })
    );

    const client = createClient();

    await client.createThread({ title: 'Thread 1' });
    await client.listThreads();
    await client.getThread(10);
    await client.getThreadMessages(10);
    await client.runInThread(10, { prompt: 'hello from thread' });

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(requestFromCall(fetchMock.mock.calls[0]).url).toBe(
      'https://example.com/api/v1/developer/threads'
    );
    expect(requestFromCall(fetchMock.mock.calls[1]).url).toBe(
      'https://example.com/api/v1/developer/threads?limit=20&offset=0'
    );
    expect(requestFromCall(fetchMock.mock.calls[2]).url).toBe(
      'https://example.com/api/v1/developer/threads/10'
    );
    expect(requestFromCall(fetchMock.mock.calls[3]).url).toBe(
      'https://example.com/api/v1/developer/threads/10/messages?limit=50&offset=0'
    );
    expect(requestFromCall(fetchMock.mock.calls[4]).url).toBe(
      'https://example.com/api/v1/developer/threads/10/runs'
    );
    expect(requestFromCall(fetchMock.mock.calls[4]).method).toBe('POST');
  });

  it('validates runInThread prompt and deleteThread unsupported behavior', async () => {
    const client = new TaskForceAI({ apiKey: 'key' });
    await expect(client.runInThread(1, { prompt: '' })).rejects.toThrow(
      'Prompt must be a non-empty string'
    );
    await expect(client.deleteThread(1)).rejects.toThrow('deleteThread is not supported');
  });

  it('validates thread identifiers before issuing requests', async () => {
    const fetchMock = installFetchMock();
    const client = new TaskForceAI({ apiKey: 'key' });

    await expect(client.getThread(0)).rejects.toThrow('Thread ID must be a positive integer');
    await expect(client.getThreadMessages(Number.NaN)).rejects.toThrow(
      'Thread ID must be a positive integer'
    );
    await expect(client.runInThread(-1, { prompt: 'hello' })).rejects.toThrow(
      'Thread ID must be a positive integer'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls file list/get/delete endpoints', async () => {
    const fetchMock = installFetchResponses(
      createMockResponse({ data: [], total: 0, limit: 20, offset: 0 }),
      createMockResponse({
        id: 'file_1',
        filename: 'doc.txt',
        purpose: 'assistants',
        bytes: 5,
        created_at: 1_767_225_600,
        mime_type: 'text/plain',
      }),
      createMockResponse({})
    );

    const client = createClient();

    const list = await client.listFiles();
    expect(list.total).toBe(0);
    const file = await client.getFile('file_1');
    expect(file.id).toBe('file_1');
    await client.deleteFile('file_1');

    expect(requestFromCall(fetchMock.mock.calls[0]).url).toBe(
      'https://example.com/api/v1/developer/files?limit=20&offset=0'
    );
    expect(requestFromCall(fetchMock.mock.calls[1]).url).toBe(
      'https://example.com/api/v1/developer/files/file_1'
    );
    expect(requestFromCall(fetchMock.mock.calls[2]).url).toBe(
      'https://example.com/api/v1/developer/files/file_1'
    );
    expect(requestFromCall(fetchMock.mock.calls[2]).method).toBe('DELETE');
  });

  it('rejects malformed thread and file endpoint responses', async () => {
    installFetchResponses(
      createMockResponse({ id: 'not-a-number', timestamp: 'now' }),
      createMockResponse({
        conversations: [{ id: 1, timestamp: 'Missing fields' }],
        total: 1,
        limit: 20,
        offset: 0,
        has_more: false,
      }),
      createMockResponse({
        messages: [{ id: 1, thread_id: 2, role: 'system', content: 'bad' }],
      }),
      createMockResponse({ taskId: 'task' }),
      createMockResponse({ data: [{ id: 'file_1', filename: 'missing metadata' }], total: 1 }),
      createMockResponse({ id: 'file_1', filename: 'missing metadata' })
    );

    const client = createClient();

    await expect(client.createThread({ title: 'bad' })).rejects.toThrow(
      'Invalid thread response from server'
    );
    await expect(client.listThreads()).rejects.toThrow(
      'Invalid thread list item 0 response from server'
    );
    await expect(client.getThreadMessages(2)).rejects.toThrow(
      'Invalid thread message 0 response from server'
    );
    await expect(client.runInThread(1, { prompt: 'hello' })).rejects.toThrow(
      'Invalid thread run response from server'
    );
    await expect(client.listFiles()).rejects.toThrow(
      'Invalid file list item 0 response from server'
    );
    await expect(client.getFile('file_1')).rejects.toThrow('Invalid file response from server');
  });
});
