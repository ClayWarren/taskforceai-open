import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, waitFor } from '@testing-library/react-native';

import {
  useDisconnectFinanceConnectionMutation,
  useFinanceDashboardQuery,
  useSyncFinanceMutation,
} from '../../../hooks/api/finance';
import { mobileLogger } from '../../../logger';
import { renderHookWithQueryClient } from '../../helpers/query-client';

const mockClient = {
  getFinanceDashboard: jest.fn().mockResolvedValue({ connections: [], accounts: [] }),
  syncFinanceData: jest.fn().mockResolvedValue({ synced: true }),
  disconnectFinanceConnection: jest.fn().mockResolvedValue(undefined),
};

jest.mock('../../../api/client', () => ({
  getMobileClient: () => mockClient,
}));

jest.mock('../../../logger', () => ({
  mobileLogger: { error: jest.fn() },
}));

const mockLoggerError = mobileLogger.error as jest.MockedFunction<typeof mobileLogger.error>;

describe('mobile finance hooks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads the finance dashboard and honors the enabled option', async () => {
    const dashboard = { connections: [{ id: 7 }], accounts: [{ id: 9 }] };
    mockClient.getFinanceDashboard.mockResolvedValueOnce(dashboard);

    const { result } = await renderHookWithQueryClient(() => useFinanceDashboardQuery());
    await waitFor(() => expect(result.current.data).toEqual(dashboard));

    expect(mockClient.getFinanceDashboard).toHaveBeenCalledTimes(1);

    mockClient.getFinanceDashboard.mockClear();
    await renderHookWithQueryClient(() => useFinanceDashboardQuery({ enabled: false }));
    expect(mockClient.getFinanceDashboard).not.toHaveBeenCalled();
  });

  it('syncs finance data and invalidates the dashboard query', async () => {
    const { result, queryClient } = await renderHookWithQueryClient(() =>
      useSyncFinanceMutation()
    );
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(mockClient.syncFinanceData).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['finance'] });
  });

  it('logs finance sync failures', async () => {
    const error = new Error('sync failed');
    mockClient.syncFinanceData.mockRejectedValueOnce(error);
    const { result } = await renderHookWithQueryClient(() => useSyncFinanceMutation());

    await act(async () => {
      await expect(result.current.mutateAsync()).rejects.toThrow('sync failed');
    });

    expect(mockLoggerError).toHaveBeenCalledWith(
      '[useSyncFinanceMutation] Failed to sync finance data',
      { error }
    );
  });

  it('disconnects finance connections and invalidates the dashboard query', async () => {
    const { result, queryClient } = await renderHookWithQueryClient(() =>
      useDisconnectFinanceConnectionMutation()
    );
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync(42);
    });

    expect(mockClient.disconnectFinanceConnection).toHaveBeenCalledWith(42);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['finance'] });
  });

  it('logs finance disconnect failures', async () => {
    const error = new Error('disconnect failed');
    mockClient.disconnectFinanceConnection.mockRejectedValueOnce(error);
    const { result } = await renderHookWithQueryClient(() =>
      useDisconnectFinanceConnectionMutation()
    );

    await act(async () => {
      await expect(result.current.mutateAsync(42)).rejects.toThrow('disconnect failed');
    });

    expect(mockLoggerError).toHaveBeenCalledWith(
      '[useDisconnectFinanceConnectionMutation] Failed to disconnect finance',
      { error }
    );
  });
});
