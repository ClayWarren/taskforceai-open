import { type RunRequest, runRequestSchema } from '@taskforceai/contracts/contracts';
import type { PendingChange } from '@taskforceai/persistence';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const toPendingStatus = (value: unknown): 'pending' | 'failed' | 'queued' | null =>
  value === 'pending' || value === 'failed' || value === 'queued' ? value : null;

export const toRunPayload = (value: unknown): RunRequest | null => {
  const parsed = runRequestSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

export const createPendingChangeFromPrompt = (prompt: {
  id?: number;
  conversationId: string;
  prompt: string;
  status: 'pending' | 'failed' | 'queued';
  createdAt: number;
  runPayload?: unknown;
}): PendingChange => {
  const runPayload = toRunPayload(prompt.runPayload);
  const change: PendingChange = {
    type: 'prompt',
    entityId: prompt.conversationId,
    operation: 'create',
    data: {
      prompt: prompt.prompt,
      status: prompt.status,
      ...(runPayload ? { runPayload } : {}),
    },
    createdAt: prompt.createdAt,
  };
  if (prompt.id !== undefined) {
    change.id = prompt.id;
  }
  return change;
};

export const createPendingPromptInsert = (
  change: PendingChange
): {
  conversationId: string;
  prompt: string;
  createdAt: number;
  status: 'pending' | 'failed' | 'queued';
  runPayload?: RunRequest;
} => {
  let prompt = '';
  let status: 'pending' | 'failed' | 'queued' = 'queued';
  let runPayload: RunRequest | undefined;

  if (isRecord(change.data)) {
    if (typeof change.data['prompt'] === 'string') {
      prompt = change.data['prompt'];
    }
    const parsedStatus = toPendingStatus(change.data['status']);
    if (parsedStatus) {
      status = parsedStatus;
    }
    const parsedRunPayload = toRunPayload(change.data['runPayload']);
    if (parsedRunPayload) {
      runPayload = parsedRunPayload;
    }
  }

  return {
    conversationId: change.entityId,
    prompt,
    createdAt: change.createdAt,
    status,
    ...(runPayload ? { runPayload } : {}),
  };
};

export const createPendingPromptUpdate = (
  data: unknown
): Partial<{
  status: 'pending' | 'failed' | 'queued';
  prompt: string;
  runPayload: RunRequest;
}> | null => {
  if (!isRecord(data)) {
    return null;
  }

  const payload: Partial<{
    status: 'pending' | 'failed' | 'queued';
    prompt: string;
    runPayload: RunRequest;
  }> = {};

  const status = toPendingStatus(data['status']);
  if (status) {
    payload.status = status;
  }
  if (typeof data['prompt'] === 'string') {
    payload.prompt = data['prompt'];
  }
  const runPayload = toRunPayload(data['runPayload']);
  if (runPayload) {
    payload.runPayload = runPayload;
  }

  return Object.keys(payload).length ? payload : null;
};
