import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, waitFor } from '@testing-library/react-native';

import { useAgentsQuery, useUpsertAgentMutation } from '../../../hooks/api/agents';
import { renderHookWithQueryClient } from '../../helpers/query-client';

const mockClient = {
  listAgents: jest.fn(),
  upsertAgent: jest.fn(),
};

jest.mock('../../../api/client', () => ({
  getMobileClient: () => mockClient,
}));

describe('mobile scheduled agent hooks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClient.listAgents.mockResolvedValue([]);
    mockClient.upsertAgent.mockResolvedValue({ id: 'agent-1' });
  });

  it('loads agents only while the scheduled screen is enabled', async () => {
    const disabled = await renderHookWithQueryClient(() => useAgentsQuery(false));
    expect(disabled.result.current.fetchStatus).toBe('idle');
    expect(mockClient.listAgents).not.toHaveBeenCalled();

    const enabled = await renderHookWithQueryClient(() => useAgentsQuery(true));
    await waitFor(() => expect(enabled.result.current.data).toEqual([]));
    expect(mockClient.listAgents).toHaveBeenCalledTimes(1);
  });

  it('upserts an agent and invalidates the scheduled agent list', async () => {
    const { result, queryClient } = await renderHookWithQueryClient(() =>
      useUpsertAgentMutation()
    );
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');
    const input = {
      name: 'Daily brief',
      autonomyEnabled: true,
      timezone: 'America/Chicago',
      activeStart: '00:00',
      activeEnd: '23:59',
      activeDays: [0, 1, 2, 3, 4, 5, 6],
      check_interval: 600,
    };

    await act(async () => {
      await result.current.mutateAsync(input);
    });

    expect(mockClient.upsertAgent).toHaveBeenCalledWith(input);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['agents'] });
  });
});
