import { fetchExecutionTrace } from '@taskforceai/api-client/api/tasks';
import { withCsrf } from '@taskforceai/api-client/auth/csrf';

export type TaskApprovalDecision = {
  approved: boolean;
  result?: Record<string, unknown>;
  error?: string;
};

export const submitTaskApprovalDecision = async (
  taskId: string,
  decision: TaskApprovalDecision
): Promise<void> => {
  const requestInit = await withCsrf({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(decision),
  });
  const response = await fetch(`/api/v1/tasks/${encodeURIComponent(taskId)}/approve`, requestInit);
  if (!response.ok) {
    throw new Error(`Failed to submit task approval decision (${response.status}).`);
  }
};

export const fetchTaskExecutionTrace = fetchExecutionTrace;
