import { beforeEach, describe, expect, it, mock } from 'bun:test';

const mockReadStoredWebMcpServers = mock<
  () => Array<{ name: string; endpoint: string; enabled: boolean }>
>(() => []);
const mockInspectDesktopMcpServer = mock(async () => ({
  tools: [{ name: 'search', title: 'Search', description: 'Find docs' }],
}));

mock.module('./store', () => ({
  readStoredWebMcpServers: mockReadStoredWebMcpServers,
}));

mock.module('../platform/desktop/mcp', () => ({
  inspectDesktopMcpServer: mockInspectDesktopMcpServer,
}));

import { formatMcpInventorySummary } from '@taskforceai/react-core';
import { loadAvailableWebMcpTools } from './inventory';

describe('web mcp inventory', () => {
  beforeEach(() => {
    mockReadStoredWebMcpServers.mockReset();
    mockInspectDesktopMcpServer.mockClear();
  });

  it('returns null summary when nothing is enabled', async () => {
    mockReadStoredWebMcpServers.mockReturnValue([
      { name: 'docs', endpoint: 'https://x', enabled: false },
    ]);

    const summary = await loadAvailableWebMcpTools('browser', {
      discover: mock(async () => ({ tools: [] })),
    } as never);

    expect(summary).toEqual({ serverCount: 0, toolCount: 0, items: [] });
    expect(formatMcpInventorySummary(summary)).toBeNull();
  });

  it('aggregates tools for browser runtime', async () => {
    mockReadStoredWebMcpServers.mockReturnValue([
      { name: 'docs', endpoint: 'https://x', enabled: true },
    ]);

    const summary = await loadAvailableWebMcpTools('browser', {
      discover: mock(async () => ({
        tools: [{ name: 'lookup', title: 'Lookup', description: 'Find docs' }],
      })),
    } as never);

    expect(summary.items).toEqual([
      {
        source: 'mcp',
        serverName: 'docs',
        toolName: 'lookup',
        title: 'Lookup',
        description: 'Find docs',
      },
    ]);
    expect(formatMcpInventorySummary(summary)).toBe('MCP tools available: 1 across 1 server.');
  });

  it('uses the desktop bridge for desktop runtime', async () => {
    mockReadStoredWebMcpServers.mockReturnValue([
      { name: 'docs', endpoint: 'https://x', enabled: true },
    ]);

    const summary = await loadAvailableWebMcpTools('desktop', {
      discover: mock(async () => ({ tools: [] })),
    } as never);

    expect(summary.toolCount).toBe(1);
    expect(mockInspectDesktopMcpServer).toHaveBeenCalledTimes(1);
  });
});
