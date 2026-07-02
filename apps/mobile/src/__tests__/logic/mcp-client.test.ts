import { beforeEach, describe, expect, it, mock } from 'bun:test';

const clientInstances: FakeMcpClient[] = [];
const transportInstances: FakeStreamableHttpTransport[] = [];

class FakeMcpClient {
  connect = mock(async (_transport: FakeStreamableHttpTransport) => undefined);

  constructor(
    public readonly clientInfo: unknown,
    public readonly options: unknown
  ) {
    clientInstances.push(this);
  }
}

class FakeStreamableHttpTransport {
  constructor(
    public readonly url: URL,
    public readonly init: { fetch?: typeof fetch }
  ) {
    transportInstances.push(this);
  }
}

mock.module('@modelcontextprotocol/sdk/client', () => ({
  Client: FakeMcpClient,
}));

mock.module('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: FakeStreamableHttpTransport,
}));

import { connectMobileMcpClient, parseMobileMcpEndpoint } from '../../mcp/client';

describe('mobile mcp client', () => {
  beforeEach(() => {
    clientInstances.length = 0;
    transportInstances.length = 0;
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
  });

  it('parses public HTTPS MCP endpoints and rejects insecure endpoints', () => {
    expect(parseMobileMcpEndpoint(' https://mcp.example.com/rpc ').url.href).toBe(
      'https://mcp.example.com/rpc'
    );

    expect(() => parseMobileMcpEndpoint('http://mcp.example.com/rpc')).toThrow(
      'Mobile MCP endpoints must use https in production builds.'
    );
  });

  it('rejects private HTTPS hosts outside development builds', () => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;

    expect(() => parseMobileMcpEndpoint('https://127.0.0.1/mcp')).toThrow(
      'Mobile MCP endpoints must use a public HTTPS host in production builds.'
    );
    expect(() => parseMobileMcpEndpoint('https://192.168.1.20/mcp')).toThrow(
      'Mobile MCP endpoints must use a public HTTPS host in production builds.'
    );
  });

  it('connects an SDK client with a streamable HTTP transport', async () => {
    const connected = await connectMobileMcpClient('https://mcp.example.com/rpc');

    expect(clientInstances).toHaveLength(1);
    expect(transportInstances).toHaveLength(1);
    expect(clientInstances[0]?.clientInfo).toEqual({
      name: 'taskforceai-mobile',
      version: '0.3.0',
    });
    expect(clientInstances[0]?.options).toEqual({ capabilities: {} });
    expect(transportInstances[0]?.url.href).toBe('https://mcp.example.com/rpc');
    expect(typeof transportInstances[0]?.init.fetch).toBe('function');
    expect(clientInstances[0]?.connect).toHaveBeenCalledWith(transportInstances[0]);
    expect(connected).toEqual({
      client: clientInstances[0],
      transport: transportInstances[0],
    });
  });
});
