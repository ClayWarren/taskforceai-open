import {
  SharedMcpManager,
  type McpConnectedSession,
  type McpPromptSummary,
  type McpResourceSummary,
  type McpServerConfig,
  type McpServerSnapshot,
  type McpToolSummary,
} from '@taskforceai/react-core';

import type { ConnectedWebMcpClient, WebMcpEndpoint, WebMcpTransportKind } from './client';
import { connectWebMcpClient, parseWebMcpEndpoint } from './client';

export type WebMcpServerConfig = McpServerConfig;
export type WebMcpToolSummary = McpToolSummary;
export type WebMcpPromptSummary = McpPromptSummary;
export type WebMcpResourceSummary = McpResourceSummary;
export type WebMcpServerSnapshot = McpServerSnapshot<{
  transport: WebMcpTransportKind;
}>;

type WebMcpManagerOptions = {
  connect?: (rawEndpoint: string) => Promise<McpConnectedSession>;
  parseEndpoint?: (rawEndpoint: string) => WebMcpEndpoint;
};

export class WebMcpManager extends SharedMcpManager<
  WebMcpEndpoint,
  { transport: WebMcpTransportKind }
> {
  constructor(options: WebMcpManagerOptions = {}) {
    super({
      connect:
        options.connect ??
        (connectWebMcpClient as (rawEndpoint: string) => Promise<McpConnectedSession>),
      parseEndpoint: options.parseEndpoint ?? parseWebMcpEndpoint,
      isEndpointMatch: (left, right) =>
        left.transport === right.transport && left.url.toString() === right.url.toString(),
      getSnapshotExtra: (session) => ({
        transport: session.endpoint.transport,
      }),
    });
  }
}

export type { ConnectedWebMcpClient };
