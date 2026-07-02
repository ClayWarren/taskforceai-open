import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act } from '@testing-library/react-native';

import { useConversationsQuery, useDeleteConversationMutation } from '../../../hooks/api/conversations';
import { renderHookWithQueryClient } from '../../helpers/query-client';

const mockClient = {
  getConversations: jest.fn().mockResolvedValue([]),
  deleteConversation: jest.fn().mockResolvedValue(undefined),
};

jest.mock('../../../api/client', () => ({
  getMobileClient: () => mockClient,
}));

jest.mock('../../../logger', () => ({
  createModuleLogger: () => ({ error: jest.fn() }),
  mobileLogger: { error: jest.fn() },
}));

describe('useConversationsQuery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls getConversations with default limit and pageParam', async () => {
    mockClient.getConversations.mockResolvedValueOnce([]);
    renderHookWithQueryClient(() => useConversationsQuery());

    await act(async () => { await new Promise(r => setTimeout(r, 10)); });

    expect(mockClient.getConversations).toHaveBeenCalledWith(20, 0);
  });

  it('calls getConversations with specified limit', async () => {
    mockClient.getConversations.mockResolvedValueOnce([]);
    renderHookWithQueryClient(() => useConversationsQuery({ limit: 10 }));

    await act(async () => { await new Promise(r => setTimeout(r, 10)); });

    expect(mockClient.getConversations).toHaveBeenCalledWith(10, 0);
  });

  it('is disabled when enabled option is false', async () => {
    mockClient.getConversations.mockClear();
    renderHookWithQueryClient(() => useConversationsQuery({ enabled: false }));

    expect(mockClient.getConversations).not.toHaveBeenCalled();
  });

  it('returns conversation data', async () => {
    const mockConversations = [{ id: 1, title: 'Test' }];
    mockClient.getConversations.mockResolvedValueOnce(mockConversations);
    const { result } = renderHookWithQueryClient(() => useConversationsQuery());

    await act(async () => { await new Promise(r => setTimeout(r, 10)); });

    expect(result.current.data).toEqual({ pageParams: [0], pages: [mockConversations] });
  });
});

describe('useDeleteConversationMutation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls deleteConversation with id', async () => {
    const { result } = renderHookWithQueryClient(() => useDeleteConversationMutation());

    await act(async () => {
      await result.current.mutateAsync(42);
    });

    expect(mockClient.deleteConversation).toHaveBeenCalledWith(42);
  });

  it('invalidates conversations query on success', async () => {
    const { result, queryClient } = renderHookWithQueryClient(() => useDeleteConversationMutation());
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync(1);
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['conversations'] });
  });

  it('handles errors', async () => {
    mockClient.deleteConversation.mockRejectedValueOnce(new Error('Not found'));
    const { result } = renderHookWithQueryClient(() => useDeleteConversationMutation());

    await act(async () => {
      try {
        await result.current.mutateAsync(999);
      } catch {
        // Expected
      }
    });

    expect(result.current.isError).toBe(true);
  });
});
