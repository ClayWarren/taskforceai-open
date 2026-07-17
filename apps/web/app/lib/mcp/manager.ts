import {
  SharedMcpManager,
  type McpConnectedSession,
  type McpServerConfig,
} from '@taskforceai/react-core';

import type { WebMcpEndpoint, WebMcpTransportKind } from './client';
import { connectWebMcpClient, parseWebMcpEndpoint } from './client';

export type WebMcpServerConfig = McpServerConfig;
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
