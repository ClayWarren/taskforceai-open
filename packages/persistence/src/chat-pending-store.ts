import { type RunRequest, runRequestSchema } from '@taskforceai/contracts/contracts';

import type { PendingChange, StorageAdapter } from './storage-adapter';

const now = () => Date.now();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const toPendingPromptStatus = (value: unknown): PendingPrompt['status'] =>
  value === 'pending' || value === 'failed' || value === 'queued' ? value : 'queued';

const toRunPayload = (value: unknown): RunRequest | undefined => {
  const parsed = runRequestSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
};

export type PendingPrompt = {
  id?: number;
  conversationId: string;
  prompt: string;
  createdAt: number;
  status: 'queued' | 'pending' | 'failed';
  runPayload?: RunRequest;
};

export class PendingPromptStore {
  constructor(private readonly adapter: StorageAdapter) {}

  async enqueuePrompt(
    conversationId: string,
    prompt: string,
    runPayload?: RunRequest
  ): Promise<void> {
    const data: { prompt: string; status: 'queued'; runPayload?: RunRequest } = {
      prompt,
      status: 'queued',
    };
    if (runPayload) {
      data.runPayload = runPayload;
    }

    const record: PendingChange = {
      type: 'prompt',
      entityId: conversationId,
      operation: 'create',
      data,
      createdAt: now(),
    };
    await this.adapter.addPendingChange(record);
  }

  async updatePromptStatus(id: number, status: 'queued' | 'pending' | 'failed'): Promise<void> {
    const changes = await this.adapter.getPendingChanges();
    const existing = changes.find((change) => change.id === id);
    const data = isRecord(existing?.data) ? { ...existing.data, status } : { status };
    await this.adapter.updatePendingChangeData(id, data);
  }

  async removePrompt(id: number): Promise<void> {
    await this.adapter.removePendingChange(id);
  }

  async listPendingPrompts(): Promise<PendingPrompt[]> {
    const changes = await this.adapter.getPendingChanges();
    const prompts = changes
      .map(mapPendingChangeToPrompt)
      .filter((prompt): prompt is PendingPrompt => prompt !== null);

    return orderPendingPromptsByCreatedAt(prompts);
  }
}

const orderPendingPromptsByCreatedAt = (prompts: PendingPrompt[]): PendingPrompt[] => {
  return prompts.toSorted((left, right) => left.createdAt - right.createdAt);
};

export const mapPendingChangeToPrompt = (change: PendingChange): PendingPrompt | null => {
  if (change.type !== 'prompt' || change.operation !== 'create' || !isRecord(change.data)) {
    return null;
  }

  const prompt = change.data['prompt'];
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    return null;
  }

  const mappedPrompt: PendingPrompt = {
    conversationId: change.entityId,
    prompt,
    createdAt: change.createdAt,
    status: toPendingPromptStatus(change.data['status']),
  };

  const runPayload = toRunPayload(change.data['runPayload']);
  if (runPayload) {
    mappedPrompt.runPayload = runPayload;
  }

  if (typeof change.id === 'number') {
    mappedPrompt.id = change.id;
  }

  return mappedPrompt;
};
