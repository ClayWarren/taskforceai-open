import type { PendingApproval } from '@taskforceai/shared';
import { fulfillPendingMcpApprovalCore, resolveEnabledMcpServer } from '@taskforceai/react-core';

import { withCsrf } from '@taskforceai/contracts/auth/csrf';
import { logger } from '../logger';
import type { PlatformRuntime } from '../platform/platform-interfaces';
import { callDesktopMcpTool, type DesktopMcpServerConfig } from '../platform/desktop/mcp';
import type { WebMcpManager, WebMcpServerConfig } from './manager';
import { readStoredWebMcpServers } from './store';

const resolveWebServer = (serverName: string): Promise<WebMcpServerConfig> =>
  resolveEnabledMcpServer(serverName, readStoredWebMcpServers);

const resolveServerForRuntime = (
  runtime: PlatformRuntime,
  serverName: string
): Promise<WebMcpServerConfig | DesktopMcpServerConfig> => {
  void runtime;
  return resolveWebServer(serverName);
};

const submitApprovalDecision = async (
  taskId: string,
  body: { approved: boolean; result?: Record<string, unknown>; error?: string }
): Promise<void> => {
  const requestInit = await withCsrf({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const response = await fetch(`/api/v1/tasks/${encodeURIComponent(taskId)}/approve`, requestInit);
  if (!response.ok) {
    throw new Error(`Failed to submit task approval decision (${response.status}).`);
  }
};

export const fulfillPendingMcpApproval = async ({
  taskId,
  approval,
  runtime,
  manager,
}: {
  taskId: string;
  approval: PendingApproval | null;
  runtime: PlatformRuntime;
  manager: WebMcpManager;
}): Promise<boolean> => {
  return fulfillPendingMcpApprovalCore({
    taskId,
    approval,
    resolveServer: (serverName) => resolveServerForRuntime(runtime, serverName),
    executeTool: (server, toolName, argumentsObject) =>
      runtime === 'desktop'
        ? callDesktopMcpTool(server as DesktopMcpServerConfig, toolName, argumentsObject)
        : manager.callTool(server, toolName, argumentsObject),
    submitApprovalDecision,
    logFailure: ({ error, taskId: failedTaskId, approval: failedApproval }) => {
      logger.warn('Failed to fulfill MCP approval request', {
        error,
        taskId: failedTaskId,
        approval: failedApproval,
      });
    },
  });
};
