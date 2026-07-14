import type { McpRuntimeToolDescriptor } from '@taskforceai/client-core';

import type { McpServerConfig, McpServerSnapshot } from './mcpManager';

export type McpInventorySummary = {
  serverCount: number;
  toolCount: number;
  items: McpRuntimeToolDescriptor[];
};

const compareMcpInventoryItems = (
  left: McpRuntimeToolDescriptor,
  right: McpRuntimeToolDescriptor
) => left.serverName.localeCompare(right.serverName) || left.toolName.localeCompare(right.toolName);

const orderMcpInventoryItems = (items: McpRuntimeToolDescriptor[]): McpRuntimeToolDescriptor[] =>
  items.sort(compareMcpInventoryItems);

export const loadAvailableMcpTools = async <
  TServerConfig extends McpServerConfig,
  TSnapshot extends Pick<McpServerSnapshot, 'tools'>,
>(
  loadServers: () => Promise<TServerConfig[]> | TServerConfig[],
  inspectServer: (server: TServerConfig) => Promise<TSnapshot | null>
): Promise<McpInventorySummary> => {
  const enabledServers = (await loadServers()).filter((server) => server.enabled);
  if (enabledServers.length === 0) {
    return { serverCount: 0, toolCount: 0, items: [] };
  }

  const snapshots = await Promise.all(
    enabledServers.map(async (server) => {
      try {
        return await inspectServer(server);
      } catch {
        return null;
      }
    })
  );

  const items = orderMcpInventoryItems(
    snapshots.flatMap((snapshot, index) =>
      (snapshot?.tools ?? []).map((tool) => ({
        source: 'mcp' as const,
        serverName: enabledServers[index]?.name ?? '',
        toolName: tool.name,
        title: tool.title.trim(),
        description: tool.description.trim(),
      }))
    )
  );

  return {
    serverCount: enabledServers.length,
    toolCount: items.length,
    items,
  };
};

export const formatMcpInventorySummary = (summary: McpInventorySummary): string | null => {
  if (summary.toolCount === 0) {
    return null;
  }
  return `MCP tools available: ${summary.toolCount} across ${summary.serverCount} server${summary.serverCount === 1 ? '' : 's'}.`;
};
