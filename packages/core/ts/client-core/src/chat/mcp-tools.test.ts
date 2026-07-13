import { describe, expect, it } from 'bun:test';

import { buildMcpClientToolsOption, formatMcpToolCallCommand } from './mcp-tools';

describe('formatMcpToolCallCommand', () => {
  it('formats a slash command for a discovered MCP tool', () => {
    expect(formatMcpToolCallCommand('docs', 'lookup')).toBe('/mcp call docs lookup ');
  });
});

describe('buildMcpClientToolsOption', () => {
  it('returns undefined when no MCP tools are available', () => {
    expect(buildMcpClientToolsOption([])).toBeUndefined();
  });

  it('builds a normalized clientTools payload for run options', () => {
    expect(
      buildMcpClientToolsOption([
        {
          source: 'mcp',
          serverName: 'docs',
          toolName: 'lookup',
          title: 'Lookup',
          description: 'Find docs',
        },
      ])
    ).toEqual({
      clientTools: {
        mcp: [
          {
            source: 'mcp',
            serverName: 'docs',
            toolName: 'lookup',
            title: 'Lookup',
            description: 'Find docs',
          },
        ],
      },
    });
  });
});
