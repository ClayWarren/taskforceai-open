import { waitFor } from '@testing-library/react-native';

import { useCloudTasksQuery } from '../../../hooks/api/cloudTasks';
import { renderHookWithQueryClient } from '../../helpers/query-client';

const desktopTask = {
  task_id: 'desktop-task',
  source: 'desktop',
  status: 'processing',
  prompt: 'Desktop prompt',
};

const cloudTask = {
  task_id: 'cloud-task',
  source: 'mobile',
  status: 'processing',
  prompt: 'Cloud prompt',
};

const mockClient = {
  listActiveTasks: jest.fn().mockResolvedValue({ tasks: [desktopTask, cloudTask] }),
};

jest.mock('../../../api/client', () => ({
  getMobileClient: () => mockClient,
}));

describe('useCloudTasksQuery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClient.listActiveTasks.mockResolvedValue({ tasks: [desktopTask, cloudTask] });
  });

  it('loads active tasks and filters out desktop sessions', async () => {
    const { result } = await renderHookWithQueryClient(() => useCloudTasksQuery(true));

    await waitFor(() => {
      expect(result.current.data).toEqual([cloudTask]);
    });
    expect(mockClient.listActiveTasks).toHaveBeenCalledWith(50);
  });

  it('does not load tasks while disabled', async () => {
    await renderHookWithQueryClient(() => useCloudTasksQuery(false));

    expect(mockClient.listActiveTasks).not.toHaveBeenCalled();
  });
});
