import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import type { PendingApproval } from '@taskforceai/client-core';

const withCsrfMock = vi.fn();
const fulfillPendingMcpApprovalCoreMock = vi.fn();

vi.mock('@taskforceai/api-client/auth/csrf', () => ({
  withCsrf: withCsrfMock,
}));

vi.mock('@taskforceai/react-core', () => ({
  fulfillPendingMcpApprovalCore: fulfillPendingMcpApprovalCoreMock,
}));

import { fulfillPendingMcpApproval } from './approval';

const originalFetch = globalThis.fetch;

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
    withCsrfMock.mockImplementation(async (init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set('X-CSRF-Token', 'csrf-token');
      return { ...init, headers };
    });
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
    globalThis.fetch = vi.fn(
      async () => new Response(null, { status: 204 })
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('submits an explicit denial for MCP tool approvals with CSRF headers', async () => {
    const manager = { callTool: vi.fn(async () => ({ ok: true })) };

    const fulfilled = await fulfillPendingMcpApproval({
      taskId: 'task/with spaces',
      approval: mcpApproval,
      runtime: 'browser',
      manager: manager as never,
    });

    expect(fulfilled).toBe(true);
    expect(manager.callTool).not.toHaveBeenCalled();
    expect(withCsrfMock).toHaveBeenCalledWith({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        approved: false,
        error: 'MCP tool execution requires explicit user approval.',
      }),
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/v1/tasks/task%2Fwith%20spaces/approve',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          approved: false,
          error: 'MCP tool execution requires explicit user approval.',
        }),
      })
    );
    const [, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(new Headers(init.headers).get('X-CSRF-Token')).toBe('csrf-token');
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
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(withCsrfMock).not.toHaveBeenCalled();
    expect(manager.callTool).not.toHaveBeenCalled();
  });

  it('rejects when the approval endpoint fails', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(null, { status: 503 })
    ) as unknown as typeof fetch;

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
