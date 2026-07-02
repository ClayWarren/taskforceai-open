import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { RunResponse } from '@taskforceai/contracts/contracts';

import { cancelTask, fetchExecutionTrace, runTask, uploadAttachment } from './tasks';

const mockClient = {
  cancelTask: mock(),
  getExecutionTrace: mock(),
  runTask: mock(),
  uploadAttachment: mock(),
};
let browserClient = mockClient;

mock.module('@taskforceai/contracts/browserClient', () => ({
  getBrowserClient: mock(() => browserClient),
  setBrowserClient: mock((client) => {
    browserClient = client ?? mockClient;
  }),
  clearBrowserClientCache: mock(() => {
    browserClient = mockClient;
  }),
}));

describe('tasks api', () => {
  beforeEach(() => {
    mockClient.cancelTask.mockReset();
    mockClient.getExecutionTrace.mockReset();
    mockClient.runTask.mockReset();
    mockClient.uploadAttachment.mockReset();
    browserClient = mockClient;
  });

  describe('runTask', () => {
    it('returns success with data', async () => {
      const mockResult: RunResponse = {
        task_id: 'task-123',
        status: 'completed',
      };
      mockClient.runTask.mockResolvedValue(mockResult);

      const result = await runTask({ prompt: 'Hello world' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(mockResult);
      }
    });

    it('returns rate limit error when 429', async () => {
      const error = Object.assign(new Error('Too Many Requests'), {
        status: 429,
        body: { resetTime: '2023-01-01T00:00:00Z' },
      });
      mockClient.runTask.mockRejectedValue(error);

      const result = await runTask({ prompt: 'Hello world' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('rate_limit');
        expect(result.error.resetTime).toBe('2023-01-01T00:00:00Z');
      }
    });

    it('omits reset time when rate-limit response body is not an object', async () => {
      const error = Object.assign(new Error('Too Many Requests'), {
        status: 429,
        body: 'retry later',
      });
      mockClient.runTask.mockRejectedValue(error);

      const result = await runTask({ prompt: 'Hello world' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('rate_limit');
        expect(result.error.resetTime).toBeUndefined();
      }
    });

    it('returns unauthorized error when 401', async () => {
      const error = Object.assign(new Error('Unauthorized'), { status: 401 });
      mockClient.runTask.mockRejectedValue(error);

      const result = await runTask({ prompt: 'Hello world' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('unauthorized');
      }
    });

    it('returns server error on server failure', async () => {
      const error = Object.assign(new Error('Server Error'), { status: 500 });
      mockClient.runTask.mockRejectedValue(error);

      const result = await runTask({ prompt: 'Hello world' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('server');
      }
    });

    it('returns network error on exception', async () => {
      mockClient.runTask.mockRejectedValue(new Error('Failed'));

      const result = await runTask({ prompt: 'Hello world' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('network');
      }
    });
  });

  describe('cancelTask', () => {
    it('returns success with canceled task data', async () => {
      const mockResult: RunResponse = {
        task_id: 'task-123',
        status: 'canceled',
      };
      mockClient.cancelTask.mockResolvedValue(mockResult);

      const result = await cancelTask('task-123');

      expect(mockClient.cancelTask).toHaveBeenCalledWith('task-123');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(mockResult);
      }
    });

    it('returns mapped errors when cancel fails', async () => {
      mockClient.cancelTask.mockRejectedValue(
        Object.assign(new Error('Not found'), { status: 404 })
      );

      const result = await cancelTask('missing-task');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatchObject({
          kind: 'not_found',
          message: 'Failed to stop run',
          status: 404,
        });
      }
    });
  });

  describe('uploadAttachment', () => {
    it('returns the uploaded attachment id', async () => {
      mockClient.uploadAttachment.mockResolvedValue({ id: 'attachment-1' });

      await expect(uploadAttachment(new Blob(['hello']))).resolves.toBe('attachment-1');
    });

    it('rethrows upload errors', async () => {
      const error = new Error('upload failed');
      mockClient.uploadAttachment.mockRejectedValue(error);

      await expect(uploadAttachment(new Blob(['hello']))).rejects.toBe(error);
    });
  });

  describe('fetchExecutionTrace', () => {
    it('returns trace data on success', async () => {
      const trace = {
        id: 'trace-1',
        task_id: 'task-123',
        goal: 'Test task',
        plan: { steps: ['step-1'] },
        steps: [{ id: 'step-1', status: 'completed' }],
        self_eval: { status: 'complete' },
        artifacts: [],
        created_at: '2026-06-12T00:00:00Z',
      };
      mockClient.getExecutionTrace.mockResolvedValue({ trace });

      const result = await fetchExecutionTrace('task-123');

      expect(mockClient.getExecutionTrace).toHaveBeenCalledWith('task-123');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(trace);
      }
    });

    it('maps missing traces to not found errors', async () => {
      mockClient.getExecutionTrace.mockRejectedValue(
        Object.assign(new Error('missing'), { status: 404 })
      );

      const result = await fetchExecutionTrace('missing-task');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatchObject({
          kind: 'not_found',
          message: 'Failed to fetch execution trace',
          status: 404,
        });
      }
    });

    it('maps trace fetch server errors', async () => {
      mockClient.getExecutionTrace.mockRejectedValue(
        Object.assign(new Error('trace unavailable'), { status: 500 })
      );

      const result = await fetchExecutionTrace('task-500');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatchObject({
          kind: 'server',
          message: 'Failed to fetch execution trace',
          status: 500,
        });
      }
    });
  });
});
