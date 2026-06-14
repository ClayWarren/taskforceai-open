import { Client } from '@modelcontextprotocol/sdk/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { parseMcpEndpoint } from '@taskforceai/shared/mcp/endpoint';

const WEB_MCP_CLIENT_NAME = 'taskforceai-web';
const WEB_MCP_CLIENT_VERSION = '1.0.0';

export type WebMcpTransportKind = 'streamable-http' | 'sse';

export type WebMcpEndpoint = {
  transport: WebMcpTransportKind;
  url: URL;
};

export type ConnectedWebMcpClient = {
  client: Client;
  transport: StreamableHTTPClientTransport | SSEClientTransport;
};

export const createWebMcpClient = (): Client =>
  new Client(
    {
      name: WEB_MCP_CLIENT_NAME,
      version: WEB_MCP_CLIENT_VERSION,
    },
    { capabilities: {} }
  );

export const parseWebMcpEndpoint = (raw: string): WebMcpEndpoint => {
  const endpoint = parseMcpEndpoint(raw, { allowSse: true });
  return endpoint;
};

export const createWebMcpTransport = (
  endpoint: WebMcpEndpoint
): StreamableHTTPClientTransport | SSEClientTransport => {
  if (endpoint.transport === 'sse') {
    return new SSEClientTransport(endpoint.url, {
      fetch: globalThis.fetch.bind(globalThis),
    });
  }

  return new StreamableHTTPClientTransport(endpoint.url, {
    fetch: globalThis.fetch.bind(globalThis),
  });
};

export const connectWebMcpClient = async (rawEndpoint: string): Promise<ConnectedWebMcpClient> => {
  const endpoint = parseWebMcpEndpoint(rawEndpoint);
  const client = createWebMcpClient();
  const transport = createWebMcpTransport(endpoint);
  await client.connect(transport);
  return { client, transport };
};
