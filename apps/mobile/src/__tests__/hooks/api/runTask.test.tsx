import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useRunTaskMutation } from '../../../hooks/api/runTask';

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

const mockClient = {
  runTask: jest.fn().mockResolvedValue({ task_id: 'test-task-id' }),
};

jest.mock('../../../api/client', () => ({
  getMobileClient: () => mockClient,
}));

jest.mock('../../../logger', () => ({
  createModuleLogger: () => ({ error: jest.fn() }),
  mobileLogger: { error: jest.fn() },
}));

const renderHook = <T,>(useHook: () => T): { result: { current: T }; queryClient: QueryClient } => {
  const queryClient = createTestQueryClient();
  const result: { current: T | any } = { current: undefined };

  const Wrapper = () => {
    result.current = useHook();
    return null;
  };

  act(() => {
    TestRenderer.create(
      <QueryClientProvider client={queryClient}>
        <Wrapper />
      </QueryClientProvider>
    );
  });

  return { result, queryClient };
};

describe('useRunTaskMutation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls runTask with body', async () => {
    const body = { prompt: 'Hello', demo: false };
    const { result } = renderHook(() => useRunTaskMutation());

    await act(async () => {
      await result.current.mutateAsync(body);
    });

    expect(mockClient.runTask).toHaveBeenCalledWith(body);
  });

  it('returns task_id on success', async () => {
    mockClient.runTask.mockResolvedValueOnce({ task_id: 'abc-123', conversation_id: 'conv-1' });
    const { result } = renderHook(() => useRunTaskMutation());

    const response = await act(async () => result.current.mutateAsync({ prompt: 'Test' }));

    expect(response).toEqual({ task_id: 'abc-123', conversation_id: 'conv-1' });
  });

  it('invalidates conversations query on success', async () => {
    const { result, queryClient } = renderHook(() => useRunTaskMutation());
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync({ prompt: 'Test' });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['conversations'] });
  });

  it('handles errors', async () => {
    mockClient.runTask.mockRejectedValueOnce(new Error('Task failed'));
    const { result } = renderHook(() => useRunTaskMutation());

    await act(async () => {
      try {
        await result.current.mutateAsync({ prompt: 'Test' });
      } catch {
        // Expected
      }
      await new Promise(r => setTimeout(r, 10));
    });

    expect(result.current.isError).toBe(true);
  });

  it('accepts all task parameters', async () => {
    const body = {
      prompt: 'Complex task',
      demo: true,
      conversation_id: 'existing-conv',
      projectId: 5,
      modelId: 'gpt-4',
    };
    const { result } = renderHook(() => useRunTaskMutation());

    await act(async () => {
      await result.current.mutateAsync(body);
    });

    expect(mockClient.runTask).toHaveBeenCalledWith(body);
  });
});
