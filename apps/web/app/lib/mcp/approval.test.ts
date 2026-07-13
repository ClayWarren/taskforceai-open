import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import type { PendingApproval } from '@taskforceai/client-core';

const getCsrfTokenMock = vi.fn();
const approveTaskMock = vi.fn();
const getBrowserClientMock = vi.fn();
const fulfillPendingMcpApprovalCoreMock = vi.fn();

vi.mock('@taskforceai/api-client/auth/csrf', () => ({
  getCsrfToken: getCsrfTokenMock,
}));

vi.mock('@taskforceai/api-client/browserClient', () => ({
  getBrowserClient: getBrowserClientMock,
}));

vi.mock('@taskforceai/react-core', () => ({
  fulfillPendingMcpApprovalCore: fulfillPendingMcpApprovalCoreMock,
}));

import { ApiClientError } from '@taskforceai/api-client/client';
import { fulfillPendingMcpApproval } from './approval';

const mcpApproval: PendingApproval = {
  permission: 'tools:mcp',
  agentName: 'Research',
  patterns: [],
  metadata: {
    source: 'mcp',
    action: 'tool_call',
    serverName: 'docs',
    toolName: 'lookup',
    arguments: { query: 'sync' },
  },
};

describe('fulfillPendingMcpApproval', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    approveTaskMock.mockResolvedValue('Decision sent');
    getBrowserClientMock.mockReturnValue({ approveTask: approveTaskMock });
    getCsrfTokenMock.mockResolvedValue('csrf-token');
    fulfillPendingMcpApprovalCoreMock.mockImplementation(
      async ({ taskId, approval, submitApprovalDecision }) => {
        if (approval?.metadata?.source !== 'mcp') {
          return false;
        }
        await submitApprovalDecision(taskId, {
          approved: false,
          error: 'MCP tool execution requires explicit user approval.',
        });
        return true;
      }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('submits an explicit denial through the CSRF-configured browser client', async () => {
    const manager = { callTool: vi.fn(async () => ({ ok: true })) };

    const fulfilled = await fulfillPendingMcpApproval({
      taskId: 'task/with spaces',
      approval: mcpApproval,
      runtime: 'browser',
      manager: manager as never,
    });

    expect(fulfilled).toBe(true);
    expect(manager.callTool).not.toHaveBeenCalled();
    expect(getBrowserClientMock).toHaveBeenCalledWith({ getCsrfToken: getCsrfTokenMock });
    expect(approveTaskMock).toHaveBeenCalledWith('task/with spaces', {
      approved: false,
      error: 'MCP tool execution requires explicit user approval.',
    });
    expect(fulfillPendingMcpApprovalCoreMock).toHaveBeenCalledWith({
      taskId: 'task/with spaces',
      approval: mcpApproval,
      submitApprovalDecision: expect.any(Function),
    });
  });

  it('returns false and performs no request for non-MCP approvals', async () => {
    const manager = { callTool: vi.fn(async () => ({ ok: true })) };

    const fulfilled = await fulfillPendingMcpApproval({
      taskId: 'task-1',
      approval: { ...mcpApproval, metadata: { source: 'other' } },
      runtime: 'desktop',
      manager: manager as never,
    });

    expect(fulfilled).toBe(false);
    expect(getBrowserClientMock).not.toHaveBeenCalled();
    expect(approveTaskMock).not.toHaveBeenCalled();
    expect(getCsrfTokenMock).not.toHaveBeenCalled();
    expect(manager.callTool).not.toHaveBeenCalled();
  });

  it('rejects when the approval endpoint fails', async () => {
    approveTaskMock.mockRejectedValueOnce(new ApiClientError(503, null));

    await expect(
      fulfillPendingMcpApproval({
        taskId: 'task-1',
        approval: mcpApproval,
        runtime: 'browser',
        manager: { callTool: vi.fn() } as never,
      })
    ).rejects.toThrow('Failed to submit task approval decision (503).');
  });

  it('does not pass local MCP execution callbacks to the shared denial core', async () => {
    const manager = { callTool: vi.fn(async () => ({ content: 'result' })) };
    fulfillPendingMcpApprovalCoreMock.mockImplementationOnce(async (options) => {
      expect(options).not.toHaveProperty('resolveServer');
      expect(options).not.toHaveProperty('executeTool');
      expect(options).not.toHaveProperty('logFailure');
      return true;
    });

    const fulfilled = await fulfillPendingMcpApproval({
      taskId: 'task-1',
      approval: mcpApproval,
      runtime: 'browser',
      manager: manager as never,
    });

    expect(fulfilled).toBe(true);
    expect(manager.callTool).not.toHaveBeenCalled();
  });
});
