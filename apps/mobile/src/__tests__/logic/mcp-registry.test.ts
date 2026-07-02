import { beforeEach, describe, expect, it, mock } from 'bun:test';

const mockLoadAvailableMobileMcpTools = mock(async () => ({
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
}));
const subscribeState: { listener?: () => void } = {};
const mockSubscribeMobileMcpServers = mock((listener: () => void) => {
  subscribeState.listener = listener;
  return () => {};
});

mock.module('../../mcp/inventory', () => ({
  loadAvailableMobileMcpTools: mockLoadAvailableMobileMcpTools,
}));

mock.module('../../mcp/store', () => ({
  subscribeMobileMcpServers: mockSubscribeMobileMcpServers,
}));

import { MobileMcpToolRegistry } from '../../mcp/registry';

describe('mobile mcp registry', () => {
  beforeEach(() => {
    mockLoadAvailableMobileMcpTools.mockClear();
    mockSubscribeMobileMcpServers.mockClear();
  });

  it('refreshes and stores the latest inventory snapshot', async () => {
    const registry = new MobileMcpToolRegistry({} as never);

    const snapshot = await registry.refresh();

    expect(snapshot).toEqual({
      toolSummary: 'MCP tools available: 2 across 1 server.',
      inventory: {
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
      },
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
    expect(registry.getSnapshot()).toEqual(snapshot);
  });

  it('notifies subscribers immediately and on refresh', async () => {
    const registry = new MobileMcpToolRegistry({} as never);
    const listener = mock(() => {});

    const unsubscribe = registry.subscribe(listener);
    await registry.refresh();
    unsubscribe();

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('binds to store updates', () => {
    const registry = new MobileMcpToolRegistry({} as never);

    registry.bindStore();
    subscribeState.listener?.();

    expect(mockSubscribeMobileMcpServers).toHaveBeenCalledTimes(1);
    expect(mockLoadAvailableMobileMcpTools).toHaveBeenCalledTimes(1);
  });
});
