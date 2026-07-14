import { waitFor } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { useStorageSummaryQuery } from '../../../hooks/api/storage';
import { renderHookWithQueryClient } from '../../helpers/query-client';

const mockGetStorageSummary = jest.fn();

jest.mock('../../../api/client', () => ({
  getMobileClient: () => ({
    getStorageSummary: mockGetStorageSummary,
  }),
}));

describe('useStorageSummaryQuery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads the mobile storage summary and caches it under the storage query key', async () => {
    const summary = {
      usedBytes: 512,
      limitBytes: 1024,
      artifactBytes: 128,
      messageBytes: 384,
    };
    mockGetStorageSummary.mockResolvedValueOnce(summary);

    const { result, queryClient } = await renderHookWithQueryClient(() => useStorageSummaryQuery());

    await waitFor(() => expect(result.current.data).toEqual(summary));
    expect(mockGetStorageSummary).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(['storage'])).toEqual(summary);
  });

  it('does not call the mobile client when disabled', async () => {
    const { result } = await renderHookWithQueryClient(() => useStorageSummaryQuery({ enabled: false }));

    expect(result.current.fetchStatus).toBe('idle');
    expect(mockGetStorageSummary).not.toHaveBeenCalled();
  });
});
