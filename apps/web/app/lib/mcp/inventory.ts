import { loadAvailableMcpTools, type McpInventorySummary } from '@taskforceai/react-core';

import type { PlatformRuntime } from '../platform/platform-interfaces';
import { inspectDesktopMcpServer, type DesktopMcpServerConfig } from '../platform/desktop/mcp';
import type { WebMcpManager } from './manager';
import { readStoredWebMcpServers } from './store';

export type WebMcpInventorySummary = {
  serverCount: number;
  toolCount: number;
  items: McpInventorySummary['items'];
};

export const loadAvailableWebMcpTools = async (
  runtime: PlatformRuntime,
  manager: WebMcpManager
): Promise<WebMcpInventorySummary> => {
  return loadAvailableMcpTools(
    () => readStoredWebMcpServers(),
    async (server) => {
      if (runtime === 'desktop') {
        const snapshot = await inspectDesktopMcpServer(server as DesktopMcpServerConfig);
        return {
          tools: snapshot.tools,
        };
      }
      return manager.discover(server);
    }
  );
};
