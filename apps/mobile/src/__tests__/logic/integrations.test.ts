import { beforeEach, describe, expect, it, mock } from 'bun:test';

const mockClient = {
  disconnectIntegration: mock(async (_provider: string) => undefined),
  getIntegrations: mock(async () => [{ provider: 'github', connected: true }]),
};

mock.module('../../api/client', () => ({
  getMobileClient: () => mockClient,
}));

import { disconnectMobileIntegration, listMobileIntegrations } from '../../api/integrations';

describe('mobile integrations API helpers', () => {
  beforeEach(() => {
    mockClient.disconnectIntegration.mockClear();
    mockClient.getIntegrations.mockClear();
  });

  it('delegates integration listing to the mobile client', async () => {
    await expect(listMobileIntegrations()).resolves.toEqual([
      { provider: 'github', connected: true },
    ]);
    expect(mockClient.getIntegrations).toHaveBeenCalledTimes(1);
  });

  it('delegates integration disconnects to the mobile client', async () => {
    await expect(disconnectMobileIntegration('github')).resolves.toBeUndefined();
    expect(mockClient.disconnectIntegration).toHaveBeenCalledWith('github');
  });
});
