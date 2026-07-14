import type {
  StreamingRuntime,
  StreamingRuntimeHandlers,
} from '@taskforceai/web/app/lib/platform/platform-interfaces';
import { cancelDesktopAppServerRun, getDesktopAppServerRunStatus } from './app-server';
import type { AppServerRunRecord } from './app-server-types';
import { waitForTauriBridge } from './bridge';

const POLL_INTERVAL_MS = 500;
const COMPLETION_RAMP_STEP_MS = 80;
const MIN_PROCESSING_PROGRESS = 0.24;
const MAX_PROCESSING_PROGRESS = 0.92;
const PROCESSING_RAMP_MS = 60_000;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = globalThis.setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        globalThis.clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const readStatusProgress = (status: unknown): number | null => {
  if (!isRecord(status) || typeof status['progress'] !== 'number') {
    return null;
  }
  return Number.isFinite(status['progress']) ? status['progress'] : null;
};

const smoothProcessingProgress = (startedAt: number) => {
  const elapsed = Math.max(0, Date.now() - startedAt);
  const linear = MIN_PROCESSING_PROGRESS + (elapsed / PROCESSING_RAMP_MS) * 0.68;
  return clamp(linear, MIN_PROCESSING_PROGRESS, MAX_PROCESSING_PROGRESS);
};

const signatureForText = (value: string): string => {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `${value.length}:${hash >>> 0}`;
};

const agentStatusesForRun = (run: AppServerRunRecord, progressOverride?: number) => {
  if (Array.isArray(run.agentStatuses) && run.agentStatuses.length > 0) {
    if (progressOverride === undefined) {
      return run.agentStatuses;
    }
    return run.agentStatuses.map((status) => {
      if (!isRecord(status)) {
        return status;
      }
      const existingProgress = readStatusProgress(status);
      return {
        ...status,
        progress:
          existingProgress === null
            ? progressOverride
            : clamp(Math.max(existingProgress, progressOverride), 0, 1),
      };
    });
  }
  const status =
    run.status === 'completed'
      ? 'COMPLETED'
      : run.status === 'failed'
        ? 'FAILED'
        : run.status === 'canceled'
          ? 'CANCELED'
          : run.status === 'queued'
            ? 'QUEUED'
            : 'PROCESSING';
  const progress =
    run.status === 'completed' || run.status === 'failed' || run.status === 'canceled'
      ? 1
      : run.status === 'queued'
        ? 0.08
        : (progressOverride ?? MIN_PROCESSING_PROGRESS);
  return [{ agent_id: 0, status, progress }];
};

const progressPayloadForRun = (run: AppServerRunRecord, progressOverride?: number) =>
  JSON.stringify({
    type: 'progress',
    task_id: run.id,
    agent_statuses: agentStatusesForRun(run, progressOverride),
    tool_usage: run.toolEvents ?? [],
    ...(run.modelId ? { model_id: run.modelId } : {}),
  });

const toolEventsSignature = (run: AppServerRunRecord): string => {
  const events = run.toolEvents ?? [];
  return JSON.stringify(
    events.map((event) => {
      if (!isRecord(event)) {
        return event;
      }
      const signatureEvent = Object.assign({}, event);
      if (typeof event['image_base64'] === 'string') {
        signatureEvent['image_base64'] = `image:${signatureForText(event['image_base64'])}`;
      }
      return signatureEvent;
    })
  );
};

const completePayloadForRun = (run: AppServerRunRecord) =>
  JSON.stringify({
    type: 'complete',
    task_id: run.id,
    message: run.output ?? '',
    agent_statuses: agentStatusesForRun(run),
    tool_usage: run.toolEvents ?? [],
  });

const errorPayloadForRun = (run: AppServerRunRecord) =>
  JSON.stringify({
    type: 'error',
    task_id: run.id,
    error: run.error ?? (run.status === 'canceled' ? 'Run canceled' : 'Run failed'),
    agent_statuses: agentStatusesForRun(run),
  });

class DesktopStreamingRuntime implements StreamingRuntime {
  private streamAbortController: AbortController | null = null;

  async startStreaming(taskId: string, handlers: StreamingRuntimeHandlers): Promise<void> {
    await waitForTauriBridge();
    this.stopStreaming();

    const controller = new AbortController();
    this.streamAbortController = controller;
    handlers.onOpen?.();
    handlers.onMessage?.(
      JSON.stringify({
        type: 'start',
        task_id: taskId,
        agent_count: 1,
        agent_statuses: [{ agent_id: 0, status: 'QUEUED', progress: 0.05 }],
      })
    );

    void this.pollRunStatus(taskId, handlers, controller.signal);
  }

  stopStreaming(): void {
    if (this.streamAbortController) {
      this.streamAbortController.abort();
      this.streamAbortController = null;
    }
  }

  async cancelTask(taskId: string): Promise<void> {
    await cancelDesktopAppServerRun(taskId);
  }

  private async pollRunStatus(
    taskId: string,
    handlers: StreamingRuntimeHandlers,
    signal: AbortSignal
  ): Promise<void> {
    let lastUpdatedAt = 0;
    let lastToolEventsSignature = '';
    let lastProgress = 0.05;
    const startedAt = Date.now();

    while (!signal.aborted) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- Run status polling must stay sequential.
        const { run } = await getDesktopAppServerRunStatus(taskId);
        if (signal.aborted) {
          return;
        }

        const progress =
          run.status === 'processing'
            ? Math.max(lastProgress, smoothProcessingProgress(startedAt))
            : run.status === 'queued'
              ? Math.max(lastProgress, 0.08)
              : lastProgress;
        const nextToolEventsSignature = toolEventsSignature(run);

        if (
          run.updatedAt !== lastUpdatedAt ||
          nextToolEventsSignature !== lastToolEventsSignature ||
          (run.status === 'processing' && progress - lastProgress >= 0.01)
        ) {
          lastUpdatedAt = run.updatedAt;
          lastToolEventsSignature = nextToolEventsSignature;
          lastProgress = progress;
          handlers.onMessage?.(progressPayloadForRun(run, progress));
        }

        if (run.status === 'completed') {
          // oxlint-disable-next-line no-await-in-loop -- Completion ramp must run before final response.
          await this.emitCompletionRamp(run, handlers, signal, lastProgress);
          if (signal.aborted) {
            return;
          }
          handlers.onMessage?.(completePayloadForRun(run));
          return;
        }
        if (run.status === 'failed' || run.status === 'canceled') {
          handlers.onMessage?.(errorPayloadForRun(run));
          return;
        }
      } catch (error) {
        if (!signal.aborted) {
          handlers.onError?.(error);
        }
        return;
      }

      // oxlint-disable-next-line no-await-in-loop -- Polling delay is part of the loop cadence.
      await sleep(POLL_INTERVAL_MS, signal);
    }
  }

  private async emitCompletionRamp(
    run: AppServerRunRecord,
    handlers: StreamingRuntimeHandlers,
    signal: AbortSignal,
    fromProgress: number
  ): Promise<void> {
    const floor = clamp(fromProgress, MIN_PROCESSING_PROGRESS, MAX_PROCESSING_PROGRESS);
    const steps = [0.55, 0.72, 0.86, 0.94].filter((step) => step > floor + 0.03);

    for (const step of steps) {
      if (signal.aborted) {
        return;
      }
      handlers.onMessage?.(progressPayloadForRun({ ...run, status: 'processing' }, step));
      // oxlint-disable-next-line no-await-in-loop -- Completion ramp is intentionally serialized.
      await sleep(COMPLETION_RAMP_STEP_MS, signal);
    }
  }
}

export const createDesktopStreamingRuntime = (): StreamingRuntime => {
  return new DesktopStreamingRuntime();
};
