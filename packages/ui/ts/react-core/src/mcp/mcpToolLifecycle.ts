import { parsePendingMcpToolApproval, type PendingApproval } from '@taskforceai/client-core';

import type { McpServerConfig } from './mcpManager';

const normalizeName = (value: string): string => value.trim().toLowerCase();

export const resolveEnabledMcpServer = async <TServerConfig extends McpServerConfig>(
  serverName: string,
  listServers: () => Promise<TServerConfig[]> | TServerConfig[]
): Promise<TServerConfig> => {
  const normalized = normalizeName(serverName);
  const servers = await listServers();
  const server = servers.find((entry) => normalizeName(entry.name) === normalized);
  if (!server) {
    throw new Error(`No MCP server named "${serverName}" is configured.`);
  }
  if (!server.enabled) {
    throw new Error(`MCP server "${server.name}" is disabled.`);
  }
  return server;
};

export interface FulfillPendingMcpApprovalCoreOptions {
  taskId: string;
  approval: PendingApproval | null;
  submitApprovalDecision: (
    taskId: string,
    body: { approved: boolean; result?: Record<string, unknown>; error?: string }
  ) => Promise<void>;
}

export const fulfillPendingMcpApprovalCore = async ({
  taskId,
  approval,
  submitApprovalDecision,
}: FulfillPendingMcpApprovalCoreOptions): Promise<boolean> => {
  const pending = parsePendingMcpToolApproval(approval);
  if (!pending) {
    return false;
  }

  await submitApprovalDecision(taskId, {
    approved: false,
    error: 'MCP tool execution requires explicit user approval.',
  });

  return true;
};
