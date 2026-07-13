import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import { ApiClientError } from '@taskforceai/api-client/client';

import * as mobileApiClient from '../api/client';
import { fulfillPendingMcpApproval } from '../mcp/approval';
import { useMobileMcpToolCatalog } from '../mcp/useMcpToolCatalog';
import { sqliteStorage } from '../storage/sqlite-adapter';
import {
  persistOrchestrationConfig,
  readStoredOrchestrationConfig,
} from '../utils/orchestration-preference';

const mockAsyncStorage = require('@react-native-async-storage/async-storage');
const mockApproveTask = jest.fn();
const mockGetMobileClient = jest.spyOn(mobileApiClient, 'getMobileClient');
const mockGetSession = jest.spyOn(sqliteStorage, 'getSession');
const mockFulfillPendingMcpApprovalCore = jest.fn();
const mockUseSharedMcpToolCatalog = jest.fn();

jest.mock('@taskforceai/react-core', () => {
  const actual = jest.requireActual('@taskforceai/react-core') as Record<string, unknown>;
  return {
    ...actual,
    fulfillPendingMcpApprovalCore: (...args: unknown[]) =>
      mockFulfillPendingMcpApprovalCore(...args),
    useSharedMcpToolCatalog: (...args: unknown[]) => mockUseSharedMcpToolCatalog(...args),
  };
});

jest.mock('../logger', () => ({
  createModuleLogger: () => ({ error: jest.fn() }),
}));

describe('mobile shared adapters', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApproveTask.mockResolvedValue('Decision sent');
    mockGetMobileClient.mockReturnValue({ approveTask: mockApproveTask } as never);
    mockGetSession.mockResolvedValue({ ok: true, value: { accessToken: 'mobile-token' } });
    mockFulfillPendingMcpApprovalCore.mockImplementation(
      async ({ taskId, submitApprovalDecision }) => {
        await submitApprovalDecision(taskId, { approved: true });
        return true;
      }
    );
    mockAsyncStorage.getItem.mockReset();
    mockAsyncStorage.setItem.mockReset();
  });

  it('delegates pending MCP approvals to the shared policy', async () => {
    const approval = {
      server: 'docs',
      tool: 'search',
      arguments: { q: 'coverage' },
    };

    await expect(
      fulfillPendingMcpApproval({
        taskId: 'task-1',
        approval: approval as never,
        manager: {} as never,
      })
    ).resolves.toBe(true);

    expect(mockFulfillPendingMcpApprovalCore).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-1',
        approval,
        submitApprovalDecision: expect.any(Function),
      })
    );
    expect(mockGetMobileClient).toHaveBeenCalledTimes(1);
    expect(mockApproveTask).toHaveBeenCalledWith('task-1', { approved: true });
  });

  it('preserves approval status errors and the explicit missing-session error', async () => {
    mockApproveTask.mockRejectedValueOnce(new ApiClientError(503, null, 'Unavailable'));

    await expect(
      fulfillPendingMcpApproval({
        taskId: 'task-1',
        approval: {} as never,
        manager: {} as never,
      })
    ).rejects.toThrow('Failed to submit task approval decision (503).');

    mockGetSession.mockResolvedValueOnce({ ok: false, error: new Error('Missing') });
    await expect(
      fulfillPendingMcpApproval({
        taskId: 'task-1',
        approval: {} as never,
        manager: {} as never,
      })
    ).rejects.toThrow('Missing authenticated session.');
    expect(mockApproveTask).toHaveBeenCalledTimes(1);
  });

  it('round trips orchestration preferences through mobile storage', async () => {
    mockAsyncStorage.getItem.mockResolvedValueOnce(null);
    await expect(readStoredOrchestrationConfig()).resolves.toBeNull();

    const config = {
      roleModels: { reviewer: 'gpt-5' },
      budget: 5,
      agentCount: 2,
    };
    mockAsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify(config));
    await expect(readStoredOrchestrationConfig()).resolves.toEqual(config);

    await persistOrchestrationConfig(config);
    expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(
      '@taskforceai:orchestration-config',
      JSON.stringify(config)
    );

    mockAsyncStorage.getItem.mockRejectedValueOnce(new Error('read failed'));
    await expect(readStoredOrchestrationConfig()).resolves.toBeNull();

    mockAsyncStorage.setItem.mockRejectedValueOnce(new Error('write failed'));
    await expect(persistOrchestrationConfig(config)).resolves.toBeUndefined();
  });

  it('wires the mobile MCP catalog factories to the shared hook', async () => {
    mockUseSharedMcpToolCatalog.mockImplementation(
      (createManager, createRegistry, bindRegistry) => {
        const manager = createManager();
        const registry = createRegistry(manager);
        return {
          manager,
          snapshot: registry.getSnapshot(),
          cleanup: bindRegistry(registry),
        };
      }
    );

    const { result } = await renderHook(() => useMobileMcpToolCatalog());

    expect(mockUseSharedMcpToolCatalog).toHaveBeenCalledTimes(1);
    expect(result.current.manager).toBeTruthy();
    expect(result.current.snapshot).toEqual({
      toolSummary: null,
      inventory: { serverCount: 0, toolCount: 0, items: [] },
      items: [],
    });
  });
});
