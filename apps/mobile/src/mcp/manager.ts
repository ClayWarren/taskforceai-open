import {
  SharedMcpManager,
  type McpConnectedSession,
  type McpServerConfig,
} from '@taskforceai/react-core';

import type { MobileMcpEndpoint } from './client';
import { connectMobileMcpClient, parseMobileMcpEndpoint } from './client';

export type MobileMcpServerConfig = McpServerConfig;

type MobileMcpManagerOptions = {
  connect?: (rawEndpoint: string) => Promise<McpConnectedSession>;
  parseEndpoint?: (rawEndpoint: string) => MobileMcpEndpoint;
};

export class MobileMcpManager extends SharedMcpManager<MobileMcpEndpoint> {
  constructor(options: MobileMcpManagerOptions = {}) {
    super({
      connect: options.connect ?? (connectMobileMcpClient as (rawEndpoint: string) => Promise<McpConnectedSession>),
      parseEndpoint: options.parseEndpoint ?? parseMobileMcpEndpoint,
    });
  }
}
