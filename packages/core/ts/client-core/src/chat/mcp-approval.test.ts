import { describe, expect, it } from 'bun:test';

import { parsePendingMcpToolApproval } from './mcp-approval';

describe('parsePendingMcpToolApproval', () => {
  it('returns MCP tool call details for MCP execution approvals', () => {
    expect(
      parsePendingMcpToolApproval({
        permission: 'mcp.call',
        agentName: 'assistant',
        patterns: ['docs', 'lookup'],
        metadata: {
          source: 'mcp',
          action: 'tool_call',
          serverName: 'docs',
          toolName: 'lookup',
          arguments: { query: 'pricing' },
        },
      })
    ).toEqual({
      serverName: 'docs',
      toolName: 'lookup',
      argumentsObject: { query: 'pricing' },
    });
  });

  it('returns null for non-MCP approvals', () => {
    expect(
      parsePendingMcpToolApproval({
        permission: 'fs.read',
        agentName: 'assistant',
        patterns: ['**/*'],
        metadata: { source: 'enginecore' },
      })
    ).toBeNull();
  });

  it('returns null for missing or malformed approval metadata', () => {
    expect(parsePendingMcpToolApproval(null)).toBeNull();
    expect(parsePendingMcpToolApproval(undefined)).toBeNull();
    expect(
      parsePendingMcpToolApproval({
        permission: 'mcp.call',
        agentName: 'assistant',
        patterns: ['docs'],
        metadata: ['mcp'] as unknown as Record<string, unknown>,
      })
    ).toBeNull();
  });

  it('returns null when required MCP fields are blank or invalid', () => {
    const baseApproval = {
      permission: 'mcp.call',
      agentName: 'assistant',
      patterns: ['docs'],
    };

    expect(
      parsePendingMcpToolApproval({
        ...baseApproval,
        metadata: {
          source: 'mcp',
          action: 'tool_call',
          serverName: ' ',
          toolName: 'lookup',
          arguments: {},
        },
      })
    ).toBeNull();

    expect(
      parsePendingMcpToolApproval({
        ...baseApproval,
        metadata: {
          source: 'mcp',
          action: 'tool_call',
          serverName: 'docs',
          toolName: '',
          arguments: {},
        },
      })
    ).toBeNull();
  });

  it('defaults non-object MCP arguments to an empty object', () => {
    expect(
      parsePendingMcpToolApproval({
        permission: 'mcp.call',
        agentName: 'assistant',
        patterns: ['docs', 'lookup'],
        metadata: {
          source: 'mcp',
          action: 'tool_call',
          serverName: 'docs',
          toolName: 'lookup',
          arguments: ['not', 'an', 'object'],
        },
      })
    ).toEqual({
      serverName: 'docs',
      toolName: 'lookup',
      argumentsObject: {},
    });
  });
});
