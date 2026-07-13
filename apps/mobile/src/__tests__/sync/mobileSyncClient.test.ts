import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockCreateHttpSyncClient = jest.fn();
const mockPinnedFetch = jest.fn();

jest.mock('@taskforceai/sync-client', () => ({
  createHttpSyncClient: (...args: unknown[]) => mockCreateHttpSyncClient(...args),
}));

jest.mock('../../api/client', () => ({
  getMobilePinnedFetch: () => mockPinnedFetch,
}));

jest.mock('../../config/env', () => ({
  mobileEnv: { nodeEnv: 'production' },
}));

import { createMobileSyncClient } from '../../sync/mobileSyncClient';

describe('createMobileSyncClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateHttpSyncClient.mockReturnValue({ pull: jest.fn() });
  });

  it('uses bearer-only native requests so cookie state cannot trigger browser CSRF', () => {
    const getToken = jest.fn(async () => 'mobile-token');

    createMobileSyncClient({
      baseUrl: 'https://api.taskforceai.chat',
      getToken,
    });

    expect(mockCreateHttpSyncClient).toHaveBeenCalledWith(
      'https://api.taskforceai.chat',
      getToken,
      {
        fetchImpl: mockPinnedFetch,
        isProduction: true,
        credentials: 'omit',
      }
    );
  });
});
