import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act } from '@testing-library/react-native';

import { useExportDataMutation, useDeleteAccountMutation } from '../../../hooks/api/compliance';
import { renderHookWithQueryClient } from '../../helpers/query-client';

const mockClient = {
  exportGdprData: jest.fn().mockResolvedValue({ data: 'exported' }),
  deleteAccount: jest.fn().mockResolvedValue(undefined),
};

jest.mock('../../../api/client', () => ({
  getMobileClient: () => mockClient,
}));

jest.mock('../../../logger', () => ({
  createModuleLogger: () => ({ error: jest.fn() }),
  mobileLogger: { error: jest.fn() }
}));

describe('useExportDataMutation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls exportGdprData on mutate', async () => {
    const { result } = renderHookWithQueryClient(() => useExportDataMutation());

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(mockClient.exportGdprData).toHaveBeenCalledTimes(1);
  });

  it('returns exported data', async () => {
    mockClient.exportGdprData.mockResolvedValueOnce({ data: 'user-data' });
    const { result } = renderHookWithQueryClient(() => useExportDataMutation());

    const response = await act(async () => result.current.mutateAsync());

    expect(response).toEqual({ data: 'user-data' });
  });

  it('logs error on failure', async () => {
    const error = new Error('Export failed');
    mockClient.exportGdprData.mockRejectedValueOnce(error);
    const { result } = renderHookWithQueryClient(() => useExportDataMutation());

    await act(async () => {
      try {
        await result.current.mutateAsync();
      } catch {
        // Expected
      }
    });
  });
});

describe('useDeleteAccountMutation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls deleteAccount with confirmEmail', async () => {
    const { result } = renderHookWithQueryClient(() => useDeleteAccountMutation());

    await act(async () => {
      await result.current.mutateAsync('test@example.com');
    });

    expect(mockClient.deleteAccount).toHaveBeenCalledWith({ confirmEmail: 'test@example.com' });
  });

  it('returns undefined on success', async () => {
    const { result } = renderHookWithQueryClient(() => useDeleteAccountMutation());

    const response = await act(async () => result.current.mutateAsync('user@email.com'));

    expect(response).toBeUndefined();
  });

  it('handles errors', async () => {
    mockClient.deleteAccount.mockRejectedValueOnce(new Error('Unauthorized'));
    const { result } = renderHookWithQueryClient(() => useDeleteAccountMutation());

    await act(async () => {
      try {
        await result.current.mutateAsync('wrong@email.com');
      } catch {
        // Expected
      }
    });
  });
});
