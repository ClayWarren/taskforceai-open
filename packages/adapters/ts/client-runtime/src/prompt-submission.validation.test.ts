import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { err, ok } from '@taskforceai/client-core/result';

import { executePromptSubmission, submitStreamingPrompt } from './prompt-submission';
import { createSubmitStreamingParams } from './prompt-submission.test-harness';
import type {
  ExecutePromptSubmissionOptions,
  PromptSubmissionLogger,
  SubmitStreamingPromptOutcome,
} from './prompt-submission';

type Attachment = {
  name: string;
  size: number;
};

type RuntimeSubmitPayload = {
  ensureConversationId: () => Promise<string>;
  onSendMessage?: (content: string) => void;
  onConversationId?: (conversationId: number) => void;
  prepareStreaming?: (payload: {
    conversationId: string;
    prompt: string;
    agentCount?: number;
    agentLabels?: string[];
  }) => void;
  failPreparedStreaming?: (message: string, resetTime?: string) => void;
  startStreaming: (payload: {
    taskId: string;
    conversationId: string;
    prompt: string;
  }) => Promise<void>;
};

const createLogger = (): PromptSubmissionLogger => ({
  error: vi.fn(),
});

const createOptions = (
  overrides: Partial<ExecutePromptSubmissionOptions<Attachment>> = {}
): ExecutePromptSubmissionOptions<Attachment> => ({
  prompt: '  Hello there  ',
  files: [],
  modelSelectorEnabled: true,
  selectedModelId: 'model-1',
  ensureConversationId: vi.fn().mockResolvedValue('local-conversation'),
  onSendMessage: vi.fn(),
  onConversationId: vi.fn(),
  hasRateLimitError: false,
  isListening: false,
  computerUseEnabled: true,
  useLoggedInServices: true,
  quickModeEnabled: true,
  role_models: { Researcher: 'model-2' },
  budget: 25,
  autonomyEnabled: true,
  agentCount: 2,
  isAuthenticated: true,
  userPlan: 'pro',
  activeProjectId: 17,
  enqueuePrompt: vi.fn().mockResolvedValue(undefined),
  startStreaming: vi.fn().mockResolvedValue(undefined),
  submitPrompt: vi.fn(),
  uploadAttachment: vi.fn().mockResolvedValue('attachment-id'),
  getRateLimitMessage: vi.fn().mockReturnValue('Rate limited'),
  getRateLimitResetTime: vi.fn().mockReturnValue('2025-01-01T00:00:00.000Z'),
  isOffline: vi.fn().mockReturnValue(false),
  logger: createLogger(),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('client-runtime prompt submission validation', () => {
  it('submitStreamingPrompt lets quick image routing override model and agent count', async () => {
    const params = createSubmitStreamingParams({
      prompt: 'create an image of a launch control room',
      attachment_ids: [],
      modelId: null,
      quickModeEnabled: false,
      computerUseEnabled: false,
      agentCount: 4,
      projectId: undefined,
      role_models: undefined,
      budget: undefined,
      autonomyEnabled: undefined,
      useLoggedInServices: false,
    });

    await submitStreamingPrompt(params);

    expect(params.runTask).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: 'google/gemini-2.5-flash-image',
        options: expect.objectContaining({
          agentCount: 1,
          quickModeEnabled: true,
          computerUseEnabled: false,
        }),
      })
    );
  });

  it('submitStreamingPrompt forces a single agent in direct chat mode', async () => {
    const params = createSubmitStreamingParams({
      quickModeEnabled: true,
      autonomyEnabled: false,
      computerUseEnabled: false,
      useLoggedInServices: false,
      agentCount: 4,
      role_models: { Researcher: 'model-2' },
    });

    await submitStreamingPrompt(params);

    expect(params.prepareStreaming).toHaveBeenCalledWith(
      expect.objectContaining({
        agentCount: 1,
      })
    );
    expect(params.runTask).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          agentCount: 1,
          quickModeEnabled: true,
        }),
      })
    );
    expect(params.runTask).toHaveBeenCalledWith(
      expect.not.objectContaining({ role_models: expect.any(Object) })
    );
  });

  it('submitStreamingPrompt keeps role models when no agent count is selected', async () => {
    const params = createSubmitStreamingParams({
      quickModeEnabled: false,
      agentCount: undefined,
      role_models: { Researcher: 'model-2', stale: 'model-stale' },
    });

    await submitStreamingPrompt(params);

    expect(params.runTask).toHaveBeenCalledWith(
      expect.objectContaining({
        role_models: { Researcher: 'model-2', stale: 'model-stale' },
        options: expect.not.objectContaining({ agentCount: expect.any(Number) }),
      })
    );
    expect(params.prepareStreaming).toHaveBeenCalledWith(
      expect.not.objectContaining({ agentLabels: expect.any(Array) })
    );
    expect(params.startStreaming).toHaveBeenCalledWith(
      expect.not.objectContaining({ agentLabels: expect.any(Array) })
    );
  });

  it('returns a sign-in error before attempting submission when the user is anonymous', async () => {
    const options = createOptions({
      isAuthenticated: false,
      files: [],
    });

    const result = await executePromptSubmission(options);

    expect(result).toEqual({
      type: 'error',
      message: 'Please sign in to start chatting.',
    });
    expect(options.submitPrompt).not.toHaveBeenCalled();
    expect(options.uploadAttachment).not.toHaveBeenCalled();
  });

  it('blocks submissions while the form is already rate-limited or listening', async () => {
    const rateLimitedOptions = createOptions({
      hasRateLimitError: true,
    });
    const listeningOptions = createOptions({
      isListening: true,
    });

    expect(await executePromptSubmission(rateLimitedOptions)).toEqual({ type: 'blocked' });
    expect(await executePromptSubmission(listeningOptions)).toEqual({ type: 'blocked' });
    expect(rateLimitedOptions.submitPrompt).not.toHaveBeenCalled();
    expect(listeningOptions.submitPrompt).not.toHaveBeenCalled();
    expect(rateLimitedOptions.uploadAttachment).not.toHaveBeenCalled();
    expect(listeningOptions.uploadAttachment).not.toHaveBeenCalled();
  });

  it('blocks empty submissions without attachments', async () => {
    const options = createOptions({
      prompt: '   ',
      files: [],
    });

    const result = await executePromptSubmission(options);

    expect(result).toEqual({ type: 'blocked' });
    expect(options.submitPrompt).not.toHaveBeenCalled();
    expect(options.uploadAttachment).not.toHaveBeenCalled();
  });

  it('blocks offline attachment submissions before uploading files', async () => {
    const options = createOptions({
      files: [{ name: 'diagram.png', size: 4 }],
      isOffline: vi.fn().mockReturnValue(true),
    });

    const result = await executePromptSubmission(options);

    expect(result).toEqual({
      type: 'error',
      message: 'Cannot send attachments while offline. Please reconnect.',
    });
    expect(options.uploadAttachment).not.toHaveBeenCalled();
    expect(options.submitPrompt).not.toHaveBeenCalled();
  });

  it('omits the model id when the model selector is disabled', async () => {
    const submitPrompt = vi.fn().mockResolvedValue(
      ok({
        type: 'queued',
        message: 'Queued for processing',
      })
    );
    const options = createOptions({
      modelSelectorEnabled: false,
      submitPrompt,
    });

    const result = await executePromptSubmission(options);

    expect(submitPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: null,
        prompt: 'Hello there',
      })
    );
    expect(result).toEqual({
      type: 'queued',
      message: 'Queued for processing',
      shouldResetForm: true,
    });
  });

  it('uploads attachments, forwards the normalized submission payload, and returns queued', async () => {
    const attachmentA: Attachment = { name: 'brief.txt', size: 10 };
    const attachmentB: Attachment = { name: 'notes.md', size: 20 };
    const startStreaming = vi.fn().mockResolvedValue(undefined);
    const onConversationId = vi.fn();
    const onSendMessage = vi.fn();
    const submitPrompt: ExecutePromptSubmissionOptions<Attachment>['submitPrompt'] = vi.fn(
      async (params: unknown) => {
        const payload = params as RuntimeSubmitPayload;
        await payload.ensureConversationId();
        payload.onSendMessage?.('sent');
        payload.onConversationId?.(77);
        await payload.startStreaming({
          taskId: 'task-123',
          conversationId: 'local-conversation',
          prompt: 'Hello there',
        });
        const outcome: SubmitStreamingPromptOutcome = {
          type: 'queued',
          message: 'Queued for processing',
        };
        return ok(outcome);
      }
    );

    const options = createOptions({
      files: [attachmentA, attachmentB],
      privateChat: true,
      onSendMessage,
      onConversationId,
      startStreaming,
      submitPrompt,
      uploadAttachment: vi
        .fn()
        .mockResolvedValueOnce('attachment-a')
        .mockResolvedValueOnce('attachment-b'),
    });

    const result = await executePromptSubmission(options);

    expect(result).toEqual({
      type: 'queued',
      message: 'Queued for processing',
      shouldResetForm: true,
    });
    expect(options.uploadAttachment).toHaveBeenNthCalledWith(1, attachmentA);
    expect(options.uploadAttachment).toHaveBeenNthCalledWith(2, attachmentB);
    expect(submitPrompt).toHaveBeenCalledTimes(1);
    expect(submitPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Hello there',
        attachment_ids: ['attachment-a', 'attachment-b'],
        modelId: 'model-1',
        role_models: { Researcher: 'model-2' },
        budget: 25,
        autonomyEnabled: true,
        privateChat: true,
        agentCount: 2,
        projectId: 17,
        userPlan: 'pro',
        computerUseEnabled: true,
        useLoggedInServices: true,
        quickModeEnabled: true,
        ensureConversationId: options.ensureConversationId,
        enqueuePrompt: options.enqueuePrompt,
        startStreaming: expect.any(Function),
        onConversationId,
        onSendMessage,
        buildRateLimitMessage: options.getRateLimitMessage,
        readRateLimitResetTime: options.getRateLimitResetTime,
        isOffline: options.isOffline,
      })
    );
    expect(startStreaming).toHaveBeenCalledWith({
      taskId: 'task-123',
      conversationId: 'local-conversation',
      prompt: 'Hello there',
    });
    expect(onConversationId).toHaveBeenCalledWith(77);
    expect(onSendMessage).toHaveBeenCalledWith('sent');
  });

  it('maps rate-limit responses to an error result with a reset time string', async () => {
    const options = createOptions({
      files: [],
      submitPrompt: vi.fn().mockResolvedValue(
        ok({
          type: 'rate_limit',
          message: 'Try again later',
          resetTime: 1234567890,
        })
      ),
    });

    const result = await executePromptSubmission(options);

    expect(result).toEqual({
      type: 'error',
      message: 'Try again later',
      resetTime: '1234567890',
    });
  });

  it('logs attachment upload failures and returns the generic send error', async () => {
    const uploadError = new Error('storage unavailable');
    const logger = createLogger();
    const options = createOptions({
      files: [{ name: 'diagram.png', size: 4 }],
      logger,
      uploadAttachment: vi.fn().mockRejectedValue(uploadError),
    });

    const result = await executePromptSubmission(options);

    expect(result).toEqual({
      type: 'error',
      message: 'Something went wrong while sending your message. Please try again.',
    });
    expect(logger.error).toHaveBeenCalledWith('Failed to upload attachment', {
      error: uploadError,
      fileName: 'diagram.png',
    });
    expect(options.submitPrompt).not.toHaveBeenCalled();
  });

  it('returns submitted when the prompt starts streaming successfully', async () => {
    const options = createOptions({
      submitPrompt: vi.fn().mockResolvedValue(ok({ type: 'streaming_started' })),
    });

    const result = await executePromptSubmission(options);

    expect(result).toEqual({
      type: 'submitted',
      shouldResetForm: true,
    });
  });

  it('returns submitPrompt errors without resetting the form', async () => {
    const options = createOptions({
      submitPrompt: vi.fn().mockResolvedValue(
        err({
          kind: 'error',
          message: 'Could not send',
        })
      ),
    });

    const result = await executePromptSubmission(options);

    expect(result).toEqual({
      type: 'error',
      message: 'Could not send',
    });
  });

  it('fails prepared streaming when submitPrompt throws unexpectedly', async () => {
    const failPreparedStreaming = vi.fn();
    const options = createOptions({
      failPreparedStreaming,
      submitPrompt: vi.fn().mockRejectedValue(new Error('storage failed')),
    });

    const result = await executePromptSubmission(options);

    expect(result).toEqual({
      type: 'error',
      message: 'Something went wrong while sending your message. Please try again.',
    });
    expect(failPreparedStreaming).toHaveBeenCalledWith(
      'Something went wrong while sending your message. Please try again.'
    );
  });
});
