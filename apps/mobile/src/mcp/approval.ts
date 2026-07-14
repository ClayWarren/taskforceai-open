import type { PendingApproval } from '@taskforceai/client-core';
import { ApiClientError } from '@taskforceai/api-client/client';
import { fulfillPendingMcpApprovalCore } from '@taskforceai/react-core';

import { getMobileClient } from '../api/client';
import { sqliteStorage } from '../storage/sqlite-adapter';
import type { MobileMcpManager } from './manager';

const submitApprovalDecision = async (
  taskId: string,
  body: { approved: boolean; result?: Record<string, unknown>; error?: string }
): Promise<void> => {
  const session = await sqliteStorage.getSession();
  if (!session.ok) {
    throw new Error('Missing authenticated session.');
  }

  try {
    await getMobileClient().approveTask(taskId, body);
  } catch (error) {
    if (error instanceof ApiClientError) {
      throw new Error(`Failed to submit task approval decision (${error.status}).`, {
        cause: error,
      });
    }
    throw error;
  }
};

export const fulfillPendingMcpApproval = async ({
  taskId,
  approval,
}: {
  taskId: string;
  approval: PendingApproval | null;
  manager: MobileMcpManager;
}): Promise<boolean> => {
  return fulfillPendingMcpApprovalCore({
    taskId,
    approval,
    submitApprovalDecision,
  });
};
