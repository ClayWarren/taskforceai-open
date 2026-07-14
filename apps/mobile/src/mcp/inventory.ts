import {
  loadAvailableMcpTools,
  type McpInventorySummary,
} from '@taskforceai/react-core';

import type { MobileMcpManager } from './manager';
import { loadStoredMobileMcpServers } from './store';

export type MobileMcpInventorySummary = {
  serverCount: number;
  toolCount: number;
  items: McpInventorySummary['items'];
};

export const loadAvailableMobileMcpTools = async (
  manager: MobileMcpManager
): Promise<MobileMcpInventorySummary> => {
  return loadAvailableMcpTools(
    () => loadStoredMobileMcpServers(),
    (server) => manager.discover(server)
  );
};
