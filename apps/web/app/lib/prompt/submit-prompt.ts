import {
  submitStreamingPrompt,
  type SubmitStreamingPromptError as SubmitPromptError,
  type SubmitStreamingPromptOutcome as SubmitPromptOutcome,
  type SubmitStreamingPromptParams,
} from '@taskforceai/client-runtime';

import { type RunTaskError, runTask } from '@taskforceai/api-client/api/tasks';
import { logger } from '../logger';
import type { Result } from '@taskforceai/client-core/result';

type SubmitPromptParams = Omit<
  SubmitStreamingPromptParams,
  'logger' | 'privateChat' | 'readRateLimitResetTime' | 'runTask'
> & {
  readRateLimitResetTime: (error: RunTaskError) => string | undefined;
  runTask?: typeof runTask;
};

export type { SubmitPromptError, SubmitPromptOutcome };

export const submitPrompt = async (
  params: SubmitPromptParams
): Promise<Result<SubmitPromptOutcome, SubmitPromptError>> => {
  return submitStreamingPrompt({
    ...params,
    runTask: (payload) => (params.runTask ?? runTask)(payload),
    readRateLimitResetTime: (error) =>
      error.kind === 'rate_limit'
        ? params.readRateLimitResetTime({
            kind: 'rate_limit',
            message: error.message,
            ...(error.status !== undefined ? { status: error.status } : {}),
            ...(error.resetTime !== undefined ? { resetTime: error.resetTime } : {}),
          })
        : undefined,
    logger,
  });
};
