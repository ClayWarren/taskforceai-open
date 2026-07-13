export type McpRuntimeToolDescriptor = {
  source: 'mcp';
  serverName: string;
  toolName: string;
  title: string;
  description: string;
};

export type McpRuntimeToolCatalogSnapshot = {
  toolSummary: string | null;
  items: McpRuntimeToolDescriptor[];
};

export type ClientToolsOption = {
  clientTools: {
    mcp: McpRuntimeToolDescriptor[];
  };
};

export const formatMcpToolCallCommand = (serverName: string, toolName: string): string =>
  `/mcp call ${serverName} ${toolName} `;

export const buildMcpClientToolsOption = (
  items: McpRuntimeToolDescriptor[]
): ClientToolsOption | undefined => {
  if (items.length === 0) {
    return undefined;
  }

  return {
    clientTools: {
      mcp: items.map((item) => ({
        source: 'mcp',
        serverName: item.serverName,
        toolName: item.toolName,
        title: item.title,
        description: item.description,
      })),
    },
  };
};
