import { describe, expect, it } from 'bun:test';

import { WebMcpManager } from './manager';

describe('WebMcpManager', () => {
  it('discovers capabilities from a cached connection', async () => {
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
        version: '1.2.3',
      }),
      getInstructions: () => 'use responsibly',
      listTools: async () => ({
        tools: [
          {
            name: 'echo',
            title: 'Echo',
            description: 'Echo input',
            inputSchema: { type: 'object' },
          },
        ],
        nextCursor: undefined,
      }),
      listPrompts: async () => ({
        prompts: [{ name: 'starter', title: 'Starter', description: 'Help prompt' }],
        nextCursor: undefined,
      }),
      listResources: async () => ({
        resources: [
          {
            name: 'guide',
            title: 'Guide',
            description: 'Setup guide',
            uri: 'file:///guide',
            mimeType: 'text/plain',
          },
        ],
        nextCursor: undefined,
      }),
      callTool: async () => ({ content: [], isError: false }),
      close: async () => {
        closeCalls += 1;
      },
    };

    const manager = new WebMcpManager({
      connect: async () => {
        connectCalls += 1;
        return {
          client: fakeClient as never,
          transport: { close: async () => {} },
        };
      },
    });

    const server = { name: 'Docs', endpoint: 'https://example.com/mcp', enabled: true };
    const snapshot = await manager.discover(server);
    expect(snapshot.serverName).toBe('fixture-server');
    expect(snapshot.tools).toHaveLength(1);
    expect(snapshot.prompts).toHaveLength(1);
    expect(snapshot.resources).toHaveLength(1);

    await manager.discover(server);
    expect(connectCalls).toBe(1);

    await manager.closeAll();
    expect(closeCalls).toBe(1);
  });

  it('rejects disabled servers', async () => {
    const manager = new WebMcpManager();
    await expect(
      manager.discover({
        name: 'Docs',
        endpoint: 'https://example.com/mcp',
        enabled: false,
      })
    ).rejects.toThrow('MCP server Docs is disabled.');
  });
});
