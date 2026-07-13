import { beforeEach, describe, expect, it, vi } from 'bun:test';

import { err, ok } from '@taskforceai/client-core/result';

const runTaskMock = vi.fn();
const loggerMock = { warn: vi.fn() };

void vi.mock('@taskforceai/api-client/api/tasks', () => ({
  runTask: runTaskMock,
}));

void vi.mock('../logger', () => ({
  logger: loggerMock,
}));

import { submitPrompt } from './submit-prompt';

type SubmitPromptParams = Parameters<typeof submitPrompt>[0];

const createParams = (overrides: Partial<SubmitPromptParams> = {}): SubmitPromptParams => ({
  prompt: 'Ship this',
  ensureConversationId: vi.fn(async () => 'remote-42'),
  enqueuePrompt: vi.fn(async () => {}),
  startStreaming: vi.fn(async () => {}),
  buildRateLimitMessage: vi.fn(() => 'Rate limited'),
  readRateLimitResetTime: vi.fn(),
  isOffline: vi.fn(() => false),
  ...overrides,
});

const expectedRunPayload = {
  prompt: 'Ship this',
  demo: false,
  options: { agentCount: 1, quickModeEnabled: true },
};

describe('submitPrompt compatibility facade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the default web runTask and injects the web logger', async () => {
    const failure = new Error('connection failed');
    runTaskMock.mockRejectedValue(failure);
    const params = createParams();

    await expect(submitPrompt(params)).resolves.toEqual(
      err({
        kind: 'error',
        message: 'Something went wrong while sending your message. Please try again.',
      })
    );
    expect(runTaskMock).toHaveBeenCalledWith(expectedRunPayload);
    expect(loggerMock.warn).toHaveBeenCalledWith('Prompt submission failed before response', {
      error: failure,
    });
  });

  it('uses an injected runTask instead of the web default', async () => {
    const injectedOutcome = ok({ task_id: 'injected-task' });
    const injectedRunTask = vi.fn(async () => injectedOutcome);

    await expect(
      submitPrompt(
        createParams({
          runTask: injectedRunTask as NonNullable<SubmitPromptParams['runTask']>,
        })
      )
    ).resolves.toEqual(ok({ type: 'streaming_started' }));

    expect(injectedRunTask).toHaveBeenCalledWith(expectedRunPayload);
    expect(runTaskMock).not.toHaveBeenCalled();
  });

  it('translates only rate-limit errors for the web reset-time reader', async () => {
    const readRateLimitResetTime = vi.fn(() => '2026-02-10T09:00:00.000Z');
    const rateLimitError = {
      kind: 'rate_limit' as const,
      message: 'Too many requests',
      status: 429,
      resetTime: 'upstream-reset',
    };
    const rateLimitedRunTask = vi.fn(async () => err(rateLimitError));

    await expect(
      submitPrompt(
        createParams({
          readRateLimitResetTime,
          runTask: rateLimitedRunTask as NonNullable<SubmitPromptParams['runTask']>,
        })
      )
    ).resolves.toEqual(
      ok({
        type: 'rate_limit',
        message: 'Rate limited',
        resetTime: '2026-02-10T09:00:00.000Z',
      })
    );
    expect(readRateLimitResetTime).toHaveBeenCalledWith(rateLimitError);

    readRateLimitResetTime.mockClear();
    const serverRunTask = vi.fn(async () =>
      err({ kind: 'server' as const, message: 'Unavailable', status: 503 })
    );
    await submitPrompt(
      createParams({
        readRateLimitResetTime,
        runTask: serverRunTask as NonNullable<SubmitPromptParams['runTask']>,
      })
    );
    expect(readRateLimitResetTime).not.toHaveBeenCalled();
  });
});
