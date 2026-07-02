import { isRetryableError } from '@taskforceai/shared/errors';

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
        if (!this.canProcessQueue()) {
          break;
        }

        const promptId = prompt.id;
        if (typeof promptId !== 'number') {
          continue;
        }

        await this.adapter.updatePromptStatus(promptId, 'pending');
        this.adapter.invalidatePendingPrompts?.();

        if (!this.canProcessQueue()) {
          await this.adapter.updatePromptStatus(promptId, 'queued');
          this.adapter.invalidatePendingPrompts?.();
          break;
        }

        const idempotencyKey = `queue-${promptId}-${prompt.createdAt}`;
        let startedStreaming = false;

        for (let attemptIndex = 0; attemptIndex <= this.delays.length; attemptIndex += 1) {
          const isFinalAttempt = attemptIndex === this.delays.length;

          if (!this.canProcessQueue()) {
            await this.adapter.updatePromptStatus(promptId, 'queued');
            this.adapter.invalidatePendingPrompts?.();
            break;
          }

          try {
            const { modelId, attachmentIds } = extractQueuedRunPayloadMetadata(prompt.runPayload);

            const response = await this.adapter.runTask(prompt.prompt, {
              idempotencyKey,
              ...(prompt.runPayload ? { runPayload: prompt.runPayload } : {}),
              ...(modelId ? { modelId } : {}),
              ...(attachmentIds && attachmentIds.length > 0 ? { attachmentIds } : {}),
            });

            if (!response.task_id) {
              if (isFinalAttempt) {
                await this.adapter.updatePromptStatus(promptId, 'failed');
                this.adapter.invalidatePendingPrompts?.();
                break;
              }

              await this.adapter.updatePromptStatus(promptId, 'queued');
              this.adapter.invalidatePendingPrompts?.();
              this.logger.warn(
                '[PendingPromptQueueProcessor] Retrying queued prompt after empty task response',
                {
                  promptId,
                  attempt: attemptIndex + 1,
                }
              );
              await sleep(this.delays[attemptIndex]!);
              await Promise.resolve();
              if (!this.canProcessQueue()) {
                break;
              }
              await this.adapter.updatePromptStatus(promptId, 'pending');
              this.adapter.invalidatePendingPrompts?.();
              continue;
            }

            await this.adapter.startStreaming({
              taskId: response.task_id,
              conversationId: prompt.conversationId,
              prompt: prompt.prompt,
              onSettled: (reason) => {
                void this.handleSettled(promptId, reason);
              },
            });
            startedStreaming = true;
            break;
          } catch (error) {
            const retryDecision = isRetryableError(error);
            if (!isFinalAttempt && retryDecision !== false) {
              await this.adapter.updatePromptStatus(promptId, 'queued');
              this.adapter.invalidatePendingPrompts?.();

              const delay =
                typeof retryDecision === 'number' ? retryDecision : this.delays[attemptIndex]!;

              this.logger.warn('[PendingPromptQueueProcessor] Retrying queued prompt after error', {
                error,
                promptId,
                attempt: attemptIndex + 1,
                delayMs: delay,
              });

              await sleep(delay);
              await Promise.resolve();
              if (!this.canProcessQueue()) {
                break;
              }
              await this.adapter.updatePromptStatus(promptId, 'pending');
              this.adapter.invalidatePendingPrompts?.();
              continue;
            }

            this.logger.error('[PendingPromptQueueProcessor] Failed to process queued prompt', {
              error,
              promptId,
            });
            await this.adapter.updatePromptStatus(promptId, 'failed');
            this.adapter.invalidatePendingPrompts?.();
            break;
          }
        }

        if (startedStreaming || !this.canProcessQueue()) {
          break;
        }
      }
    } finally {
      this.isProcessing = false;
    }
    /* eslint-enable no-await-in-loop */
  }
}
