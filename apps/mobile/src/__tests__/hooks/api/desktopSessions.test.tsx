import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, waitFor } from '@testing-library/react-native';

import {
  useApproveDesktopSessionMutation,
  useDesktopSessionsQuery,
} from '../../../hooks/api/desktopSessions';
import { renderHookWithQueryClient } from '../../helpers/query-client';

const desktopTask = {
  task_id: 'desktop-task',
  source: 'desktop',
  status: 'processing',
  prompt: 'Desktop prompt',
};

const mobileTask = {
  task_id: 'mobile-task',
  source: 'mobile',
  status: 'processing',
  prompt: 'Mobile prompt',
};

const mockClient = {
  approveTask: jest.fn().mockResolvedValue(undefined),
  listActiveTasks: jest.fn().mockResolvedValue({ tasks: [desktopTask, mobileTask] }),
};

jest.mock('../../../api/client', () => ({
  getMobileClient: () => mockClient,
}));

jest.mock('../../../logger', () => ({
  mobileLogger: { error: jest.fn() },
}));

const { mobileLogger } = jest.requireMock('../../../logger') as {
  mobileLogger: { error: jest.Mock };
};

describe('useDesktopSessionsQuery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClient.listActiveTasks.mockResolvedValue({ tasks: [desktopTask, mobileTask] });
  });

  it('loads active tasks and keeps only desktop sessions', async () => {
    const { result } = renderHookWithQueryClient(() => useDesktopSessionsQuery());

    await waitFor(() => {
      expect(result.current.data).toEqual([desktopTask]);
    });
    expect(mockClient.listActiveTasks).toHaveBeenCalledWith(25);
  });
});

describe('useApproveDesktopSessionMutation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('submits the approval decision and invalidates desktop sessions and conversations', async () => {
    const { result, queryClient } = renderHookWithQueryClient(() =>
      useApproveDesktopSessionMutation()
    );
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync({
        taskId: 'desktop-task',
        decision: { approved: true },
      });
    });

    expect(mockClient.approveTask).toHaveBeenCalledWith('desktop-task', { approved: true });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['desktopSessions'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['conversations'] });
  });

  it('logs mutation failures', async () => {
    const error = new Error('approval failed');
    mockClient.approveTask.mockRejectedValueOnce(error);
    const { result } = renderHookWithQueryClient(() => useApproveDesktopSessionMutation());

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          taskId: 'desktop-task',
          decision: { approved: false, error: 'Denied from mobile' },
        })
      ).rejects.toThrow('approval failed');
    });

    expect(mobileLogger.error).toHaveBeenCalledWith(
      '[useApproveDesktopSessionMutation] Failed to submit session approval',
      {
        error: {
          message: 'approval failed',
          stack: expect.any(String),
        },
      }
    );
  });
});
