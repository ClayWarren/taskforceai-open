import { beforeEach, describe, expect, it, mock } from 'bun:test';

const mockInvokeTauri = mock(() => Promise.resolve(undefined));

mock.module('./bridge', () => ({
  invokeTauri: mockInvokeTauri,
}));

const loadModule = async () => import('./mcp');

describe('desktop mcp bridge', () => {
  beforeEach(() => {
    mockInvokeTauri.mockClear();
  });

  it('invokes inspect with the desktop command payload', async () => {
    const { inspectDesktopMcpServer } = await loadModule();
    const server = { name: 'local', endpoint: 'stdio://node', enabled: true };

    await inspectDesktopMcpServer(server);

    expect(mockInvokeTauri).toHaveBeenCalledWith('mcp_discover', { server });
  });

  it('blocks direct desktop tool calls', async () => {
    const { callDesktopMcpTool } = await loadModule();
    const server = { name: 'local', endpoint: 'stdio://node', enabled: true };

    await expect(callDesktopMcpTool(server, 'echo')).rejects.toThrow(
      'MCP tool execution requires explicit user approval.'
    );

    expect(mockInvokeTauri).not.toHaveBeenCalledWith('mcp_call_tool', expect.anything());
  });
});
