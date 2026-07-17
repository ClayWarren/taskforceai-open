import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act } from '@testing-library/react-native';

import { useModelSelectorQuery } from '../../../hooks/api/modelSelector';
import { renderHookWithQueryClient } from '../../helpers/query-client';

const mockClient = {
  getModelOptions: jest.fn().mockResolvedValue({ models: [], defaultModel: null }),
};

jest.mock('../../../api/client', () => ({
  getMobileClient: () => mockClient,
}));

describe('useModelSelectorQuery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls getModelOptions', async () => {
    mockClient.getModelOptions.mockResolvedValueOnce({ models: [], defaultModel: null });
    await renderHookWithQueryClient(() => useModelSelectorQuery());

    await act(async () => { await new Promise(r => setTimeout(r, 10)); });

    expect(mockClient.getModelOptions).toHaveBeenCalledTimes(1);
  });

  it('does not call getModelOptions when disabled', async () => {
    await renderHookWithQueryClient(() => useModelSelectorQuery({ enabled: false }));

    await act(async () => { await new Promise(r => setTimeout(r, 10)); });

    expect(mockClient.getModelOptions).not.toHaveBeenCalled();
  });

  it('returns model options data', async () => {
    const mockData = {
      models: [{ id: 'gpt-4', name: 'GPT-4', provider: 'openai' }],
      defaultModel: 'gpt-4',
    };
    mockClient.getModelOptions.mockResolvedValueOnce(mockData);
    const { result } = await renderHookWithQueryClient(() => useModelSelectorQuery());

    await act(async () => { await new Promise(r => setTimeout(r, 10)); });

    expect(result.current.data).toEqual(mockData);
  });

  it('uses correct query key', async () => {
    mockClient.getModelOptions.mockResolvedValueOnce({ models: [] });
    const { queryClient } = await renderHookWithQueryClient(() => useModelSelectorQuery());

    await act(async () => { await new Promise(r => setTimeout(r, 10)); });

    const cachedData = queryClient.getQueryData(['modelSelectorOptions']);
    expect(cachedData).toBeDefined();
  });

  it('handles errors gracefully', async () => {
    mockClient.getModelOptions.mockRejectedValueOnce(new Error('Network error'));
    const { result } = await renderHookWithQueryClient(() => useModelSelectorQuery());

    await act(async () => { await new Promise(r => setTimeout(r, 10)); });

    expect(result.current.isError).toBe(true);
  });
});
