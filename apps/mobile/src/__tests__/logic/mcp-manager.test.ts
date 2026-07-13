import { describe, expect, it, mock } from 'bun:test';

mock.module('../../mcp/client', () => ({
  connectMobileMcpClient: async () => {
    throw new Error('connectMobileMcpClient should not be called in unit tests');
  },
  parseMobileMcpEndpoint: (raw: string) => {
    const url = new URL(raw.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`Unsupported MCP endpoint protocol: ${url.protocol}`);
    }
    return { url };
  },
}));

import { MobileMcpManager } from '../../mcp/manager';

describe('MobileMcpManager', () => {
  it('discovers remote capabilities from a cached session', async () => {
    let connectCalls = 0;
    let closeCalls = 0;
    const fakeClient = {
      getServerCapabilities: () => ({
        tools: {},
        prompts: {},
        resources: {},
      }),
      getServerVersion: () => ({
        name: 'fixture-server',
        version: '2.0.0',
      }),
      getInstructions: () => 'mobile-safe',
      listTools: async () => ({
        tools: [{ name: 'lookup', title: 'Lookup', description: 'Find data', inputSchema: { type: 'object' } }],
        nextCursor: undefined,
      }),
      listPrompts: async () => ({
        prompts: [{ name: 'starter', title: 'Starter', description: 'Help prompt' }],
        nextCursor: undefined,
      }),
      listResources: async () => ({
        resources: [{ name: 'guide', title: 'Guide', description: 'Setup guide', uri: 'https://example.com/guide', mimeType: 'text/html' }],
        nextCursor: undefined,
      }),
      callTool: async () => ({ content: [], isError: false }),
      close: async () => {
        closeCalls += 1;
      },
    };

    const manager = new MobileMcpManager({
      connect: async () => {
        connectCalls += 1;
        return {
          client: fakeClient as never,
          transport: { close: async () => {} },
        };
      },
    });

    const server = { name: 'Remote', endpoint: 'https://example.com/mcp', enabled: true };
    const snapshot = await manager.discover(server);
    expect(snapshot.serverName).toBe('fixture-server');
    expect(snapshot.tools).toHaveLength(1);
    expect(snapshot.prompts).toHaveLength(1);
    expect(snapshot.resources).toHaveLength(1);

    await manager.discover(server);
    expect(connectCalls).toBe(1);

    await manager.close('Remote');
    expect(closeCalls).toBe(1);
  });

  it('rejects disabled servers', async () => {
    const manager = new MobileMcpManager();
    await expect(
      manager.discover({
        name: 'Remote',
        endpoint: 'https://example.com/mcp',
        enabled: false,
      }),
    ).rejects.toThrow('MCP server Remote is disabled.');
  });
});
