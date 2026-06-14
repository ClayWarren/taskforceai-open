import { beforeEach, describe, expect, it, vi } from 'bun:test';

import type { PendingApproval } from '@taskforceai/shared';

import { fulfillPendingMcpApprovalCore, resolveEnabledMcpServer } from './mcpToolLifecycle';

describe('mcpToolLifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('resolveEnabledMcpServer', () => {
    it('resolves a server by name case-insensitively', async () => {
      const server = await resolveEnabledMcpServer(' Docs ', () => [
        { name: 'docs', endpoint: 'https://example.com', enabled: true },
      ]);

      expect(server).toEqual({
        name: 'docs',
        endpoint: 'https://example.com',
        enabled: true,
      });
    });

    it('throws when the server is missing or disabled', async () => {
      await expect(resolveEnabledMcpServer('docs', () => [])).rejects.toThrow(
        'No MCP server named "docs" is configured.'
      );

      await expect(
        resolveEnabledMcpServer('docs', () => [
          { name: 'docs', endpoint: 'https://example.com', enabled: false },
        ])
      ).rejects.toThrow('MCP server "docs" is disabled.');
    });
  });

  describe('fulfillPendingMcpApprovalCore', () => {
    const approval: PendingApproval = {
      permission: 'tools:mcp',
      agentName: 'agent-1',
      patterns: [],
      metadata: {
        source: 'mcp',
        action: 'tool_call',
        serverName: 'docs',
        toolName: 'lookup',
        arguments: { query: 'sync' },
      },
    };

    it('returns false when the approval is not an MCP tool request', async () => {
      const result = await fulfillPendingMcpApprovalCore({
        taskId: 'task-1',
        approval: null,
        resolveServer: vi.fn(),
        executeTool: vi.fn(),
        submitApprovalDecision: vi.fn(),
      });

      expect(result).toBe(false);
    });

    it('denies the pending request without executing the tool', async () => {
      const resolveServer = vi.fn(async () => ({
        name: 'docs',
        endpoint: 'https://example.com',
        enabled: true,
      }));
      const executeTool = vi.fn(async () => ({ answer: 'ok' }));
      const submitApprovalDecision = vi.fn(async () => undefined);

      const result = await fulfillPendingMcpApprovalCore({
        taskId: 'task-1',
        approval,
        resolveServer,
        executeTool,
        submitApprovalDecision,
      });

      expect(result).toBe(true);
      expect(resolveServer).not.toHaveBeenCalled();
      expect(executeTool).not.toHaveBeenCalled();
      expect(submitApprovalDecision).toHaveBeenCalledWith('task-1', {
        approved: false,
        error: 'MCP tool execution requires explicit user approval.',
      });
    });

    it('does not log or expose resolver failures because it never calls local MCP', async () => {
      const submitApprovalDecision = vi.fn(async () => undefined);
      const logFailure = vi.fn();
      const resolveServer = vi.fn(async () => {
        throw new Error('server unavailable');
      });
      const executeTool = vi.fn(async () => ({ answer: 'ok' }));

      const result = await fulfillPendingMcpApprovalCore({
        taskId: 'task-1',
        approval,
        resolveServer,
        executeTool,
        submitApprovalDecision,
        logFailure,
      });

      expect(result).toBe(true);
      expect(resolveServer).not.toHaveBeenCalled();
      expect(executeTool).not.toHaveBeenCalled();
      expect(logFailure).not.toHaveBeenCalled();
      expect(submitApprovalDecision).toHaveBeenCalledWith('task-1', {
        approved: false,
        error: 'MCP tool execution requires explicit user approval.',
      });
    });
  });
});
