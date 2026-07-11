import { isRetryableError } from '@taskforceai/api-client/api/retry-policy';

import { extractQueuedRunPayloadMetadata } from './queued-run-payload';
import type { StartStreamingOptions, StreamSettlement } from './stores/createStreamingStore';
import type { PendingPromptRecord } from './types';

export interface RunTaskResponse {
  task_id: string;
}

export interface PendingPromptQueueAdapter {
  listPendingPrompts: () => Promise<PendingPromptRecord[]>;
  updatePromptStatus: (id: number, status: PendingPromptRecord['status']) => Promise<void>;
  removePrompt: (id: number) => Promise<void>;
  runTask: (
    prompt: string,
    options: {
      idempotencyKey: string;
      modelId?: string;
      attachmentIds?: string[];
      runPayload?: PendingPromptRecord['runPayload'];
    }
  ) => Promise<RunTaskResponse>;
  startStreaming: (options: StartStreamingOptions) => Promise<void>;
  invalidatePendingPrompts?: () => void;
}

export interface PendingPromptQueueLogger {
  warn: (message: string, metadata?: unknown) => void;
  error: (message: string, metadata?: unknown) => void;
}

export interface PendingPromptQueueProcessorOptions {
  adapter: PendingPromptQueueAdapter;
  logger: PendingPromptQueueLogger;
  retryDelaysMs?: number[];
  isNavigatorOnline?: () => boolean;
}

export interface PendingPromptQueueEnvironment {
  isOnline: boolean;
  isStreaming: boolean;
}

const DEFAULT_RETRY_DELAYS_MS: number[] = [1000, 5000, 15000];

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export class PendingPromptQueueProcessor {
  private readonly adapter: PendingPromptQueueAdapter;
  private readonly logger: PendingPromptQueueLogger;
  private readonly delays: number[];
  private readonly isNavigatorOnline: () => boolean;
  private active = true;
  private isProcessing = false;
  private environment: PendingPromptQueueEnvironment = {
    isOnline: false,
    isStreaming: false,
  };

  constructor(options: PendingPromptQueueProcessorOptions) {
    this.adapter = options.adapter;
    this.logger = options.logger;
    this.delays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    this.isNavigatorOnline = options.isNavigatorOnline ?? (() => true);
  }

  setActive(active: boolean): void {
    this.active = active;
  }

  setEnvironment(environment: PendingPromptQueueEnvironment): void {
    this.environment = environment;
  }

  private canProcessQueue(): boolean {
    if (!this.active) {
      return false;
    }
    if (!this.environment.isOnline || this.environment.isStreaming) {
      return false;
    }
    return this.isNavigatorOnline();
  }

  private async handleSettled(promptId: number, reason: StreamSettlement): Promise<void> {
    try {
      if (reason === 'complete') {
        await this.adapter.removePrompt(promptId);
      } else if (reason === 'error') {
        await this.adapter.updatePromptStatus(promptId, 'failed');
      } else {
        await this.adapter.updatePromptStatus(promptId, 'queued');
      }
    } catch (error) {
      this.logger.error(
        '[PendingPromptQueueProcessor] Failed to finalize queued prompt after streaming',
        {
          error,
          promptId,
        }
      );
    } finally {
      this.adapter.invalidatePendingPrompts?.();
    }
  }

  private async setPromptStatus(
    promptId: number,
    status: PendingPromptRecord['status']
  ): Promise<void> {
    await this.adapter.updatePromptStatus(promptId, status);
    this.adapter.invalidatePendingPrompts?.();
  }

  private async waitForRetry(promptId: number, delay: number): Promise<boolean> {
    await sleep(delay);
    await Promise.resolve();
    if (!this.canProcessQueue()) return false;
    await this.setPromptStatus(promptId, 'pending');
    return true;
  }

  private async handleEmptyTaskResponse(
    promptId: number,
    attemptIndex: number,
    isFinalAttempt: boolean
  ): Promise<boolean> {
    if (isFinalAttempt) {
      await this.setPromptStatus(promptId, 'failed');
      return false;
    }
    await this.setPromptStatus(promptId, 'queued');
    this.logger.warn(
      '[PendingPromptQueueProcessor] Retrying queued prompt after empty task response',
      {
        promptId,
        attempt: attemptIndex + 1,
      }
    );
    return await this.waitForRetry(promptId, this.delays[attemptIndex]!);
  }

  private async handleAttemptError(
    error: unknown,
    promptId: number,
    attemptIndex: number,
    isFinalAttempt: boolean
  ): Promise<boolean> {
    const retryDecision = isRetryableError(error);
    if (!isFinalAttempt && retryDecision !== false) {
      await this.setPromptStatus(promptId, 'queued');
      const delay = typeof retryDecision === 'number' ? retryDecision : this.delays[attemptIndex]!;
      this.logger.warn('[PendingPromptQueueProcessor] Retrying queued prompt after error', {
        error,
        promptId,
        attempt: attemptIndex + 1,
        delayMs: delay,
      });
      return await this.waitForRetry(promptId, delay);
    }
    this.logger.error('[PendingPromptQueueProcessor] Failed to process queued prompt', {
      error,
      promptId,
    });
    await this.setPromptStatus(promptId, 'failed');
    return false;
  }

  private async processPrompt(prompt: PendingPromptRecord, promptId: number): Promise<boolean> {
    await this.setPromptStatus(promptId, 'pending');
    if (!this.canProcessQueue()) {
      await this.setPromptStatus(promptId, 'queued');
      return true;
    }

    const idempotencyKey = `queue-${promptId}-${prompt.createdAt}`;
    /* eslint-disable no-await-in-loop -- retry attempts must remain sequential and stop on first success */
    for (let attemptIndex = 0; attemptIndex <= this.delays.length; attemptIndex += 1) {
      if (!this.canProcessQueue()) {
        await this.setPromptStatus(promptId, 'queued');
        return true;
      }
      const isFinalAttempt = attemptIndex === this.delays.length;
      try {
        const { modelId, attachmentIds } = extractQueuedRunPayloadMetadata(prompt.runPayload);
        const response = await this.adapter.runTask(prompt.prompt, {
          idempotencyKey,
          ...(prompt.runPayload ? { runPayload: prompt.runPayload } : {}),
          ...(modelId ? { modelId } : {}),
          ...(attachmentIds && attachmentIds.length > 0 ? { attachmentIds } : {}),
        });
        if (!response.task_id) {
          if (!(await this.handleEmptyTaskResponse(promptId, attemptIndex, isFinalAttempt))) break;
          continue;
        }
        await this.adapter.startStreaming({
          taskId: response.task_id,
          conversationId: prompt.conversationId,
          prompt: prompt.prompt,
          onSettled: (reason) => void this.handleSettled(promptId, reason),
        });
        return true;
      } catch (error) {
        if (!(await this.handleAttemptError(error, promptId, attemptIndex, isFinalAttempt))) break;
      }
    }
    /* eslint-enable no-await-in-loop */
    return !this.canProcessQueue();
  }

  async processPendingPrompts(): Promise<void> {
    if (!this.canProcessQueue() || this.isProcessing) {
      return;
    }

    /* eslint-disable no-await-in-loop -- queue processing is intentionally sequential */
    this.isProcessing = true;
    try {
      const prompts = await this.adapter.listPendingPrompts();
      if (!prompts.length) {
        return;
      }

      for (const prompt of prompts) {
        if (!this.canProcessQueue()) break;
        if (prompt.status === 'failed') continue;
        const promptId = prompt.id;
        if (typeof promptId !== 'number') continue;
        if (await this.processPrompt(prompt, promptId)) break;
      }
    } finally {
      this.isProcessing = false;
    }
    /* eslint-enable no-await-in-loop */
  }
}
