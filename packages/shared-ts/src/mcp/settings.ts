export interface McpServerSettingsEntry {
  name: string;
  endpoint: string;
  enabled: boolean;
}

export type McpServerInputResult =
  | { ok: true; value: McpServerSettingsEntry }
  | { ok: false; message: string };

export const normalizeMcpServerInput = ({
  name,
  endpoint,
  missingMessage = 'MCP server name and endpoint are required.',
}: {
  name: string;
  endpoint: string;
  missingMessage?: string;
}): McpServerInputResult => {
  const normalizedName = name.trim();
  const normalizedEndpoint = endpoint.trim();

  if (!normalizedName || !normalizedEndpoint) {
    return { ok: false, message: missingMessage };
  }

  return {
    ok: true,
    value: {
      name: normalizedName,
      endpoint: normalizedEndpoint,
      enabled: true,
    },
  };
};

export const upsertMcpServerByName = (
  servers: McpServerSettingsEntry[],
  server: McpServerSettingsEntry
): McpServerSettingsEntry[] => [
  ...servers.filter((entry) => entry.name.toLowerCase() !== server.name.toLowerCase()),
  server,
];

export const removeMcpServerByName = (
  servers: McpServerSettingsEntry[],
  serverName: string
): McpServerSettingsEntry[] =>
  servers.filter((server) => server.name.toLowerCase() !== serverName.toLowerCase());

export const formatMcpServerInspectionSummary = ({
  serverName,
  fallbackName,
  tools,
  prompts,
  resources,
}: {
  serverName?: string | null;
  fallbackName: string;
  tools: number;
  prompts: number;
  resources: number;
}): string =>
  `${serverName || fallbackName}: ${tools} tools, ${prompts} prompts, ${resources} resources.`;
