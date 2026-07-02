import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import type { PendingApproval } from '@taskforceai/shared';

const withCsrfMock = vi.fn();
const loggerWarnMock = vi.fn();
const fulfillPendingMcpApprovalCoreMock = vi.fn();
const resolveEnabledMcpServerMock = vi.fn();
const readStoredWebMcpServersMock = vi.fn();
const callDesktopMcpToolMock = vi.fn();

vi.mock('@taskforceai/contracts/auth/csrf', () => ({
  withCsrf: withCsrfMock,
}));

vi.mock('@taskforceai/react-core', () => ({
  fulfillPendingMcpApprovalCore: fulfillPendingMcpApprovalCoreMock,
  resolveEnabledMcpServer: resolveEnabledMcpServerMock,
}));

vi.mock('../logger', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: loggerWarnMock,
  },
}));

vi.mock('../platform/desktop/mcp', () => ({
  callDesktopMcpTool: callDesktopMcpToolMock,
}));

vi.mock('./store', () => ({
  readStoredWebMcpServers: readStoredWebMcpServersMock,
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
    resolveEnabledMcpServerMock.mockImplementation(async (_serverName: string, listServers) => {
      const servers = await listServers();
      return servers[0];
    });
    readStoredWebMcpServersMock.mockReturnValue([
      { name: 'docs', endpoint: 'https://example.com/mcp', enabled: true },
    ]);
    callDesktopMcpToolMock.mockResolvedValue({ ok: true });
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

  it('wires browser runtime tool execution through the web MCP manager callback', async () => {
    const manager = { callTool: vi.fn(async () => ({ content: 'result' })) };
    fulfillPendingMcpApprovalCoreMock.mockImplementationOnce(
      async ({ resolveServer, executeTool }) => {
        const server = await resolveServer('docs');
        await executeTool(server, 'lookup', { query: 'sync' });
        return true;
      }
    );

    const fulfilled = await fulfillPendingMcpApproval({
      taskId: 'task-1',
      approval: mcpApproval,
      runtime: 'browser',
      manager: manager as never,
    });

    expect(fulfilled).toBe(true);
    expect(readStoredWebMcpServersMock).toHaveBeenCalled();
    expect(resolveEnabledMcpServerMock).toHaveBeenCalledWith('docs', readStoredWebMcpServersMock);
    expect(manager.callTool).toHaveBeenCalledWith(
      { name: 'docs', endpoint: 'https://example.com/mcp', enabled: true },
      'lookup',
      { query: 'sync' }
    );
    expect(callDesktopMcpToolMock).not.toHaveBeenCalled();
  });

  it('wires desktop runtime tool execution through the desktop MCP bridge callback', async () => {
    const manager = { callTool: vi.fn(async () => ({ content: 'result' })) };
    fulfillPendingMcpApprovalCoreMock.mockImplementationOnce(
      async ({ resolveServer, executeTool }) => {
        const server = await resolveServer('docs');
        await executeTool(server, 'lookup', { query: 'sync' });
        return true;
      }
    );

    const fulfilled = await fulfillPendingMcpApproval({
      taskId: 'task-1',
      approval: mcpApproval,
      runtime: 'desktop',
      manager: manager as never,
    });

    expect(fulfilled).toBe(true);
    expect(callDesktopMcpToolMock).toHaveBeenCalledWith(
      { name: 'docs', endpoint: 'https://example.com/mcp', enabled: true },
      'lookup',
      { query: 'sync' }
    );
    expect(manager.callTool).not.toHaveBeenCalled();
  });

  it('logs core fulfillment failures with task and approval context', async () => {
    const error = new Error('local MCP failed');
    fulfillPendingMcpApprovalCoreMock.mockImplementationOnce(
      async ({ taskId, approval, logFailure }) => {
        logFailure({ error, taskId, approval });
        return false;
      }
    );

    const fulfilled = await fulfillPendingMcpApproval({
      taskId: 'task-1',
      approval: mcpApproval,
      runtime: 'browser',
      manager: { callTool: vi.fn() } as never,
    });

    expect(fulfilled).toBe(false);
    expect(loggerWarnMock).toHaveBeenCalledWith('Failed to fulfill MCP approval request', {
      error,
      taskId: 'task-1',
      approval: mcpApproval,
    });
  });
});
