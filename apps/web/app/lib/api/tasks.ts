import { fetchExecutionTrace } from '@taskforceai/api-client/api/tasks';
import { getCsrfToken } from '@taskforceai/api-client/auth/csrf';
import { getBrowserClient } from '@taskforceai/api-client/browserClient';
import { ApiClientError } from '@taskforceai/api-client/client';

export type TaskApprovalDecision = {
  approved: boolean;
  result?: Record<string, unknown>;
  error?: string;
};

export const submitTaskApprovalDecision = async (
  taskId: string,
  decision: TaskApprovalDecision
): Promise<void> => {
  try {
    await getBrowserClient({ getCsrfToken }).approveTask(taskId, decision);
  } catch (error) {
    if (error instanceof ApiClientError) {
      throw new Error(`Failed to submit task approval decision (${error.status}).`, {
        cause: error,
      });
    }
    throw error;
  }
};

export const fetchTaskExecutionTrace = fetchExecutionTrace;
