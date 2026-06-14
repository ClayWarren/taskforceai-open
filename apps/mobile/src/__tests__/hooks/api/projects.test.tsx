import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import {
  useCreateProjectMutation,
  useDeleteProjectMutation,
  useProjectsQuery,
} from '../../../hooks/api/projects';
import { renderHookWithQueryClient } from '../../helpers/query-client';

const mockClient = {
  getProjects: jest.fn().mockResolvedValue([{ id: 1, name: 'Test' }]),
  createProject: jest.fn().mockResolvedValue({ id: 1, name: 'Test' }),
  deleteProject: jest.fn().mockResolvedValue(undefined),
};

jest.mock('../../../api/client', () => ({
  getMobileClient: () => mockClient,
}));

jest.mock('../../../logger', () => ({
  createModuleLogger: () => ({ error: jest.fn() }),
  mobileLogger: { error: jest.fn() },
}));

const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => { });

describe('useProjectsQuery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads projects with the projects query key', async () => {
    const { result } = renderHookWithQueryClient(() => useProjectsQuery());

    await waitFor(() => {
      expect(result.current.data).toEqual([{ id: 1, name: 'Test' }]);
    });
    expect(mockClient.getProjects).toHaveBeenCalledTimes(1);
  });
});

describe('useCreateProjectMutation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls createProject with request data', async () => {
    const request = { name: 'New Project', description: 'Test' };
    const { result } = renderHookWithQueryClient(() => useCreateProjectMutation());

    await act(async () => {
      await result.current.mutateAsync(request);
    });

    expect(mockClient.createProject).toHaveBeenCalledWith(request);
  });

  it('invalidates projects query on success', async () => {
    const { result, queryClient } = renderHookWithQueryClient(() => useCreateProjectMutation());
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync({ name: 'Test' });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['projects'] });
  });

  it('shows success alert on success', async () => {
    const { result } = renderHookWithQueryClient(() => useCreateProjectMutation());

    await act(async () => {
      await result.current.mutateAsync({ name: 'Test' });
    });

    expect(alertSpy).toHaveBeenCalledWith('Success', 'Project created successfully');
  });

  it('shows error alert on failure', async () => {
    mockClient.createProject.mockRejectedValueOnce(new Error('Failed'));
    const { result } = renderHookWithQueryClient(() => useCreateProjectMutation());

    await act(async () => {
      try {
        await result.current.mutateAsync({ name: 'Test' });
      } catch {
        // Expected
      }
    });

    expect(alertSpy).toHaveBeenCalledWith('Error', 'Failed to create project');
  });
});

describe('useDeleteProjectMutation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls deleteProject with projectId', async () => {
    const { result } = renderHookWithQueryClient(() => useDeleteProjectMutation());

    await act(async () => {
      await result.current.mutateAsync(42);
    });

    expect(mockClient.deleteProject).toHaveBeenCalledWith(42);
  });

  it('invalidates projects query on success', async () => {
    const { result, queryClient } = renderHookWithQueryClient(() => useDeleteProjectMutation());
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync(1);
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['projects'] });
  });

  it('shows success alert on success', async () => {
    const { result } = renderHookWithQueryClient(() => useDeleteProjectMutation());

    await act(async () => {
      await result.current.mutateAsync(1);
    });

    expect(alertSpy).toHaveBeenCalledWith('Success', 'Project deleted');
  });

  it('shows error alert on failure', async () => {
    mockClient.deleteProject.mockRejectedValueOnce(new Error('Failed'));
    const { result } = renderHookWithQueryClient(() => useDeleteProjectMutation());

    await act(async () => {
      try {
        await result.current.mutateAsync(1);
      } catch {
        // Expected
      }
    });

    expect(alertSpy).toHaveBeenCalledWith('Error', 'Failed to delete project');
  });
});
