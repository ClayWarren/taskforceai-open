import type { PendingApproval } from '@taskforceai/client-core';
import { fulfillPendingMcpApprovalCore } from '@taskforceai/react-core';

import { submitTaskApprovalDecision } from '../api/tasks';
import type { PlatformRuntime } from '../platform/platform-interfaces';
import type { WebMcpManager } from './manager';

const submitApprovalDecision = async (
  taskId: string,
  body: { approved: boolean; result?: Record<string, unknown>; error?: string }
): Promise<void> => {
  await submitTaskApprovalDecision(taskId, body);
};

export const fulfillPendingMcpApproval = async ({
  taskId,
  approval,
}: {
  taskId: string;
  approval: PendingApproval | null;
  runtime: PlatformRuntime;
  manager: WebMcpManager;
}): Promise<boolean> => {
  return fulfillPendingMcpApprovalCore({
    taskId,
    approval,
    submitApprovalDecision,
  });
};
