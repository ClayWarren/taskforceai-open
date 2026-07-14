import { describe, expect, it } from 'bun:test';

import { Client } from '@modelcontextprotocol/sdk/client';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import {
  connectWebMcpClient,
  createWebMcpClient,
  createWebMcpTransport,
  parseWebMcpEndpoint,
} from './client';

describe('web mcp client endpoint parsing', () => {
  it('parses streamable HTTP endpoints by default', () => {
    const endpoint = parseWebMcpEndpoint(' https://example.com/mcp ');

    expect(endpoint.transport).toBe('streamable-http');
    expect(endpoint.url.href).toBe('https://example.com/mcp');
  });

  it('parses SSE endpoints with the sse+ prefix', () => {
    const endpoint = parseWebMcpEndpoint('sse+https://example.com/events');

    expect(endpoint.transport).toBe('sse');
    expect(endpoint.url.href).toBe('https://example.com/events');
  });

  it('rejects unsupported endpoint protocols', () => {
    expect(() => parseWebMcpEndpoint('stdio://local-server')).toThrow(
      'Unsupported MCP endpoint protocol: stdio:'
    );
  });

  it('creates clients and transports for supported endpoint kinds', () => {
    expect(createWebMcpClient()).toBeInstanceOf(Client);

    const streamableTransport = createWebMcpTransport({
      transport: 'streamable-http',
      url: new URL('https://example.com/mcp'),
    });
    const sseTransport = createWebMcpTransport({
      transport: 'sse',
      url: new URL('https://example.com/events'),
    });

    expect(streamableTransport).toBeInstanceOf(StreamableHTTPClientTransport);
    expect(sseTransport).toBeInstanceOf(SSEClientTransport);
  });

  it('connects a web MCP client with the parsed transport', async () => {
    const originalConnect = Client.prototype.connect;
    const connectedTransports: unknown[] = [];
    Client.prototype.connect = async function connect(transport: unknown) {
      connectedTransports.push(transport);
    } as typeof Client.prototype.connect;

    try {
      const connection = await connectWebMcpClient('https://example.com/mcp');

      expect(connection.client).toBeInstanceOf(Client);
      expect(connection.transport).toBeInstanceOf(StreamableHTTPClientTransport);
      expect(connectedTransports).toEqual([connection.transport]);
    } finally {
      Client.prototype.connect = originalConnect;
    }
  });
});
