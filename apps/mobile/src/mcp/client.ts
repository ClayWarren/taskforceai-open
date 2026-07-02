import type { Client as McpClient } from '@modelcontextprotocol/sdk/client';
import type { StreamableHTTPClientTransport as McpStreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Client as McpSdkClient } from '@modelcontextprotocol/sdk/client';
import { StreamableHTTPClientTransport as McpSdkStreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { parseMcpEndpoint } from '@taskforceai/shared/mcp/endpoint';

const MOBILE_MCP_CLIENT_NAME = 'taskforceai-mobile';
const MOBILE_MCP_CLIENT_VERSION = '0.3.0';
const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^\[?::1\]?$/i,
  /^\[?fc[0-9a-f]{2}:/i,
  /^\[?fd[0-9a-f]{2}:/i,
];

const isDevRuntime = (): boolean => typeof __DEV__ !== 'undefined' && __DEV__;

export type MobileMcpEndpoint = {
  url: URL;
};

export type ConnectedMobileMcpClient = {
  client: McpClient;
  transport: McpStreamableHTTPClientTransport;
};

type MobileMcpSdk = {
  Client: typeof import('@modelcontextprotocol/sdk/client').Client;
  StreamableHTTPClientTransport: typeof import('@modelcontextprotocol/sdk/client/streamableHttp.js').StreamableHTTPClientTransport;
};

const loadDefaultMobileMcpSdk = async (): Promise<MobileMcpSdk> => {
  return {
    Client: McpSdkClient,
    StreamableHTTPClientTransport: McpSdkStreamableHTTPClientTransport,
  };
};

const createMobileMcpClient = ({ Client }: Pick<MobileMcpSdk, 'Client'>): McpClient =>
  new Client(
    {
      name: MOBILE_MCP_CLIENT_NAME,
      version: MOBILE_MCP_CLIENT_VERSION,
    },
    { capabilities: {} },
  );

export const parseMobileMcpEndpoint = (raw: string): MobileMcpEndpoint => {
  const { url } = parseMcpEndpoint(raw);
  if (url.protocol !== 'https:') {
    throw new Error('Mobile MCP endpoints must use https in production builds.');
  }
  if (!isDevRuntime() && PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(url.hostname))) {
    throw new Error('Mobile MCP endpoints must use a public HTTPS host in production builds.');
  }
  return { url };
};

const createMobileMcpTransport = (
  endpoint: MobileMcpEndpoint,
  { StreamableHTTPClientTransport }: Pick<MobileMcpSdk, 'StreamableHTTPClientTransport'>
): McpStreamableHTTPClientTransport =>
  new StreamableHTTPClientTransport(endpoint.url, {
    fetch: fetch.bind(globalThis),
  });

export const connectMobileMcpClient = async (rawEndpoint: string): Promise<ConnectedMobileMcpClient> => {
  const endpoint = parseMobileMcpEndpoint(rawEndpoint);
  const sdk = await loadDefaultMobileMcpSdk();
  const client = createMobileMcpClient(sdk);
  const transport = createMobileMcpTransport(endpoint, sdk);
  await client.connect(transport);
  return { client, transport };
};
