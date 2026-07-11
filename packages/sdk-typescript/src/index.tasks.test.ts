import { describe, expect, it, vi } from 'bun:test';

import {
  createClient,
  createMockResponse,
  installFetchResponses,
  installJsonResponse,
  requestFromCall,
  TaskForceAI,
  type TaskStatus,
} from '../test/index-test-helpers';

describe('TaskForceAI task helpers', () => {
  it('validates task identifiers for status and result lookups', async () => {
    const client = new TaskForceAI({ apiKey: 'key' });
    await expect(client.getTaskStatus('')).rejects.toThrow('Task ID must be a non-empty string');
    await expect(client.getTaskResult('')).rejects.toThrow('Task ID must be a non-empty string');
  });

  it('fetches task status and result through makeRequest', async () => {
    const fetchMock = installJsonResponse({ taskId: 'task', status: 'completed', result: 'done' });
    const client = createClient();

    const status = await client.getTaskStatus('task');
    expect(status.status).toBe('completed');

    fetchMock.mockResolvedValueOnce(createMockResponse({ taskId: 'task', result: 'done' }));
    const result = await client.getTaskResult('task');
    expect(result.result).toBe('done');
  });

  it('rejects malformed task lifecycle responses', async () => {
    installFetchResponses(
      createMockResponse({ status: 'processing' }),
      createMockResponse({ taskId: 'task', status: 'unknown' }),
      createMockResponse({ taskId: 'task', status: 'completed' })
    );
    const client = createClient();

    await expect(client.submitTask('prompt')).rejects.toThrow(
      'Invalid task submission response from server'
    );
    await expect(client.getTaskStatus('task')).rejects.toThrow(
      'Invalid task status response from server'
    );
    await expect(client.getTaskResult('task')).rejects.toThrow(
      'Invalid task result response from server'
    );
  });

  it('uploads image attachments and submits attachment ids', async () => {
    const fetchMock = installFetchResponses(
      createMockResponse({ id: 'attachment-image-1', mime_type: 'image/png', size: 5 }),
      createMockResponse({ taskId: 'task_images' })
    );
    const client = createClient();

    await client.submitTask('describe this', {
      modelId: 'sentinel-large',
      images: [{ data: 'aGVsbG8=', mime_type: 'image/png', name: 'image.png' }],
    });

    const uploadRequest = requestFromCall(fetchMock.mock.calls[0]);
    expect(uploadRequest.url).toBe('https://example.com/api/v1/attachments/upload');
    expect(uploadRequest.method).toBe('POST');
    expect(uploadRequest.headers.get('Content-Type')).toContain('multipart/form-data');

    const request = requestFromCall(fetchMock.mock.calls[1]);
    const body = JSON.parse(await request.text()) as {
      modelId?: string;
      attachment_ids?: string[];
    };
    expect(body.modelId).toBe('sentinel-large');
    expect(body.attachment_ids).toEqual(['attachment-image-1']);
  });

  it('submits provided attachment ids without re-uploading', async () => {
    const fetchMock = installJsonResponse({ taskId: 'task_attachments' });
    const client = createClient();

    await client.submitTask('describe this', {
      modelId: 'sentinel-large',
      attachmentIds: ['att-1'],
      attachment_ids: ['att-2'],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requestFromCall(fetchMock.mock.calls[0]);
    const body = JSON.parse(await request.text()) as {
      attachment_ids?: string[];
    };
    expect(body.attachment_ids).toEqual(['att-2', 'att-1']);
  });

  it('handles waitForCompletion terminal, hydration, and failure paths', async () => {
    const successClient = new TaskForceAI({ apiKey: 'key' });
    const statuses: TaskStatus[] = [
      { taskId: 'task', status: 'processing' },
      { taskId: 'task', status: 'completed', result: 'done' },
    ];
    const statusSpy = vi
      .spyOn(successClient, 'getTaskStatus')
      .mockImplementation(async () => statuses.shift() as TaskStatus);
    const seen: TaskStatus[] = [];
    await expect(
      successClient.waitForCompletion('task', 5 as 2000, 5, (status) => seen.push(status))
    ).resolves.toEqual({ taskId: 'task', status: 'completed', result: 'done' });
    expect(seen).toHaveLength(2);
    expect(statusSpy).toHaveBeenCalledTimes(2);

    const hydrateClient = new TaskForceAI({ apiKey: 'key' });
    vi.spyOn(hydrateClient, 'getTaskStatus').mockResolvedValue({
      taskId: 'task',
      status: 'completed',
    });
    const resultSpy = vi.spyOn(hydrateClient, 'getTaskResult').mockResolvedValue({
      taskId: 'task',
      status: 'completed',
      result: 'resolved-from-results-endpoint',
    });
    await expect(hydrateClient.waitForCompletion('task', 5 as 2000, 1 as 150)).resolves.toEqual({
      taskId: 'task',
      status: 'completed',
      result: 'resolved-from-results-endpoint',
    });
    expect(resultSpy).toHaveBeenCalledWith('task');

    const failedClient = new TaskForceAI({ apiKey: 'key' });
    vi.spyOn(failedClient, 'getTaskStatus')
      .mockResolvedValueOnce({ taskId: 'task', status: 'failed', error: 'boom' })
      .mockResolvedValueOnce({ taskId: 'task', status: 'failed' })
      .mockResolvedValue({ taskId: 'task', status: 'processing' });
    await expect(failedClient.waitForCompletion('task')).rejects.toThrow('boom');
    await expect(failedClient.waitForCompletion('task')).rejects.toThrow('Task failed');
    await expect(failedClient.waitForCompletion('task', 5 as 2000, 2 as 150)).rejects.toThrow(
      'Task did not complete within the expected time'
    );

    const canceledClient = new TaskForceAI({ apiKey: 'key' });
    vi.spyOn(canceledClient, 'getTaskStatus').mockResolvedValue({
      taskId: 'task',
      status: 'canceled',
      error: 'Run canceled',
    });
    await expect(canceledClient.waitForCompletion('task')).rejects.toThrow('Run canceled');

    const approvalClient = new TaskForceAI({ apiKey: 'key' });
    const approvalSpy = vi
      .spyOn(approvalClient, 'getTaskStatus')
      .mockResolvedValueOnce({ taskId: 'task', status: 'processing' })
      .mockResolvedValueOnce({
        taskId: 'task',
        status: 'awaiting_approval',
        message: 'Approval required',
      });
    await expect(approvalClient.waitForCompletion('task', 0, 5)).rejects.toThrow(
      'Approval required'
    );
    expect(approvalSpy).toHaveBeenCalledTimes(2);
  });

  it('chains runTask through submitTask and waitForCompletion', async () => {
    const client = new TaskForceAI({ apiKey: 'key' });
    const submitSpy = vi.spyOn(client, 'submitTask').mockResolvedValue('task-123');
    const waitSpy = vi.spyOn(client, 'waitForCompletion').mockResolvedValue({
      taskId: 'task-123',
      status: 'completed',
      result: 'ok',
    });

    const result = await client.runTask('prompt', { mock: true }, 10, 2 as 150);

    expect(result).toEqual({ taskId: 'task-123', status: 'completed', result: 'ok' });
    expect(submitSpy).toHaveBeenCalledWith('prompt', { mock: true });
    expect(waitSpy).toHaveBeenCalledWith('task-123', 10, 2, undefined);
  });

  it('streams task status updates, terminal approval states, and runTaskStream results', async () => {
    const client = new TaskForceAI({ apiKey: 'key' });
    const statuses: TaskStatus[] = [
      { taskId: 'task', status: 'processing' },
      { taskId: 'task', status: 'completed', result: 'ok' },
    ];
    vi.spyOn(client, 'getTaskStatus').mockImplementation(
      async () => statuses.shift() as TaskStatus
    );

    const received: TaskStatus[] = [];
    for await (const status of client.streamTaskStatus('task', 0, 5)) {
      received.push(status);
    }

    expect(received).toHaveLength(2);
    expect(received[1]?.status).toBe('completed');

    const approvalClient = new TaskForceAI({ apiKey: 'key' });
    const approvalStatuses: TaskStatus[] = [
      { taskId: 'task', status: 'processing' },
      { taskId: 'task', status: 'awaiting_approval', message: 'Approval required' },
    ];
    vi.spyOn(approvalClient, 'getTaskStatus').mockImplementation(
      async () => approvalStatuses.shift() as TaskStatus
    );
    const approvalReceived: TaskStatus[] = [];
    for await (const status of approvalClient.streamTaskStatus('task', 0, 5)) {
      approvalReceived.push(status);
    }
    expect(approvalReceived).toHaveLength(2);
    expect(approvalReceived[1]?.status).toBe('awaiting_approval');

    const runStreamClient = new TaskForceAI({ apiKey: 'key' });
    vi.spyOn(runStreamClient, 'submitTask').mockResolvedValue('task-999');
    vi.spyOn(runStreamClient, 'getTaskStatus').mockResolvedValue({
      taskId: 'task-999',
      status: 'completed',
      result: 'done',
    });
    const stream = await runStreamClient.runTaskStream('prompt');
    const streamStatuses: TaskStatus[] = [];
    for await (const status of stream) {
      streamStatuses.push(status);
    }
    expect(stream.taskId).toBe('task-999');
    expect(streamStatuses).toHaveLength(1);
    expect(streamStatuses[0]?.result).toBe('done');
  });

  it('supports cancelling a task status stream', async () => {
    const client = new TaskForceAI({ apiKey: 'key' });
    vi.spyOn(client, 'getTaskStatus')
      .mockResolvedValueOnce({ taskId: 'task', status: 'processing' })
      .mockResolvedValue({ taskId: 'task', status: 'processing' });

    const stream = client.streamTaskStatus('task', 0, 5);
    const iterator = stream[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.value.status).toBe('processing');
    stream.cancel();
    await expect(iterator.next()).rejects.toThrow('Task stream cancelled');
  });

  it('honors abort signals before polling task status', async () => {
    const controller = new AbortController();
    controller.abort();
    const client = new TaskForceAI({ apiKey: 'key' });
    const statusSpy = vi.spyOn(client, 'getTaskStatus');

    await expect(
      client.waitForCompletion('task', 0, 5, undefined, controller.signal)
    ).rejects.toThrow('Task polling cancelled');
    expect(statusSpy).not.toHaveBeenCalled();
  });

  it('aborts an in-flight poll request and polling delay', async () => {
    const requestController = new AbortController();
    installFetchResponses();
    const client = new TaskForceAI({ apiKey: 'key', baseUrl: 'https://example.com' });
    const statusSpy = vi.spyOn(client, 'getTaskStatus').mockImplementation(
      (_id, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('in-flight request aborted')), {
            once: true,
          });
        })
    );

    const pendingRequest = client.waitForCompletion(
      'task',
      10_000,
      5,
      undefined,
      requestController.signal
    );
    requestController.abort();
    await expect(pendingRequest).rejects.toThrow('in-flight request aborted');
    expect(statusSpy).toHaveBeenCalledWith('task', requestController.signal);

    const delayController = new AbortController();
    statusSpy.mockResolvedValue({ taskId: 'task', status: 'processing' });
    const pendingDelay = client.waitForCompletion(
      'task',
      10_000,
      5,
      undefined,
      delayController.signal
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    delayController.abort();
    await expect(pendingDelay).rejects.toThrow('Task polling cancelled');
  });
});
