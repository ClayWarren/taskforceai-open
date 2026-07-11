import type { PendingApproval } from '@taskforceai/client-core';
import { fulfillPendingMcpApprovalCore } from '@taskforceai/react-core';

import { getMobileBaseUrl } from '../config/base-url';
import { getMobilePinnedFetch } from '../api/client';
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

  const response = await getMobilePinnedFetch()(
    `${getMobileBaseUrl()}/api/v1/tasks/${encodeURIComponent(taskId)}/approve`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.value.accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'TaskForceAI-Mobile',
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to submit task approval decision (${response.status}).`);
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
