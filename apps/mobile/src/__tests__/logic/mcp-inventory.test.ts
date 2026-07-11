import { beforeEach, describe, expect, it, mock } from 'bun:test';

const mockLoadStoredMobileMcpServers = mock(async () => []);

mock.module('../../mcp/store', () => ({
  loadStoredMobileMcpServers: mockLoadStoredMobileMcpServers,
}));

import { loadAvailableMobileMcpTools } from '../../mcp/inventory';

describe('mobile mcp inventory', () => {
  beforeEach(() => {
    mockLoadStoredMobileMcpServers.mockReset();
  });

  it('returns null summary when nothing is enabled', async () => {
    mockLoadStoredMobileMcpServers.mockResolvedValue([{ name: 'docs', endpoint: 'https://x', enabled: false }]);

    const summary = await loadAvailableMobileMcpTools({
      discover: mock(async () => ({ tools: [] })),
    } as never);

    expect(summary).toEqual({ serverCount: 0, toolCount: 0, items: [] });
  });

  it('counts discovered tools from enabled servers', async () => {
    mockLoadStoredMobileMcpServers.mockResolvedValue([
      { name: 'docs', endpoint: 'https://x', enabled: true },
    ]);

    const summary = await loadAvailableMobileMcpTools({
      discover: mock(async () => ({
        tools: [
          { name: 'lookup', title: 'Lookup', description: 'Find docs' },
          { name: 'search', title: 'Search', description: 'Search docs' },
        ],
      })),
    } as never);

    expect(summary).toEqual({
      serverCount: 1,
      toolCount: 2,
      items: [
        {
          source: 'mcp',
          serverName: 'docs',
          toolName: 'lookup',
          title: 'Lookup',
          description: 'Find docs',
        },
        {
          source: 'mcp',
          serverName: 'docs',
          toolName: 'search',
          title: 'Search',
          description: 'Search docs',
        },
      ],
    });
  });
});
