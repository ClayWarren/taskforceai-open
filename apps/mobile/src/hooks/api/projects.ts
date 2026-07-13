import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';

import { getMobileClient } from '../../api/client';
import { mobileLogger } from '../../logger';
import { queryKeys } from './queryKeys';
import type { CreateProjectRequest } from '@taskforceai/contracts/contracts';

interface UseProjectsQueryOptions {
  enabled?: boolean;
}

export const useProjectsQuery = (options: UseProjectsQueryOptions = {}) => {
  const client = getMobileClient();
  const { enabled = true } = options;

  return useQuery({
    queryKey: queryKeys.projects(),
    queryFn: () => client.getProjects(),
    enabled,
    staleTime: 60_000,
  });
};

export const useCreateProjectMutation = () => {
  const client = getMobileClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: CreateProjectRequest) => client.createProject(request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects() });
      Alert.alert('Success', 'Project created successfully');
    },
    onError: (error) => {
      mobileLogger.error('[useCreateProjectMutation] Failed to create project', {
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      });
      Alert.alert('Error', 'Failed to create project');
    },
  });
};

export const useDeleteProjectMutation = () => {
  const client = getMobileClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (projectId: number) => client.deleteProject(projectId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects() });
      Alert.alert('Success', 'Project deleted');
    },
    onError: (error) => {
      mobileLogger.error('[useDeleteProjectMutation] Failed to delete project', {
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      });
      Alert.alert('Error', 'Failed to delete project');
    },
  });
};
