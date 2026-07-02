import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { err, ok } from '@taskforceai/shared/result';
import type { ResearchWorkflowOption } from '@taskforceai/shared';

import { executePromptSubmission, submitStreamingPrompt } from './prompt-submission';
import type {
  ExecutePromptSubmissionOptions,
  PromptSubmissionLogger,
  SubmitStreamingPromptParams,
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

const createSubmitStreamingParams = (
  overrides: Partial<SubmitStreamingPromptParams> = {}
): SubmitStreamingPromptParams => ({
  prompt: 'hello',
  attachment_ids: [],
  modelId: 'model-1',
  role_models: { Researcher: 'model-2' },
  projectId: 3,
  userPlan: 'free',
  computerUseEnabled: true,
  useLoggedInServices: true,
  quickModeEnabled: false,
  autonomyEnabled: true,
  budget: 5,
  agentCount: 4,
  ensureConversationId: vi.fn().mockResolvedValue('local-conversation'),
  enqueuePrompt: vi.fn().mockResolvedValue(undefined),
  prepareStreaming: vi.fn(),
  failPreparedStreaming: vi.fn(),
  startStreaming: vi.fn().mockResolvedValue(undefined),
  onSendMessage: vi.fn(),
  onConversationId: vi.fn(),
  onApproval: vi.fn(),
  buildRateLimitMessage: vi.fn().mockReturnValue('Rate limited'),
  readRateLimitResetTime: vi.fn().mockReturnValue('2030-01-01'),
  isOffline: vi.fn().mockReturnValue(false),
  runTask: vi.fn().mockResolvedValue(ok({ task_id: 'task-1' })),
  logger: { warn: vi.fn() },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('client-runtime prompt submission', () => {
  it('submitStreamingPrompt builds a run payload and starts streaming', async () => {
    const params = createSubmitStreamingParams({
      attachment_ids: ['file-1'],
    });

    const result = await submitStreamingPrompt(params);

    expect(result).toEqual(ok({ type: 'streaming_started' }));
    expect(params.ensureConversationId).toHaveBeenCalled();
    expect(params.onSendMessage).toHaveBeenCalledWith('hello');
    expect(params.prepareStreaming).toHaveBeenCalledWith({
      conversationId: 'local-conversation',
      prompt: 'hello',
      agentCount: 4,
      agentLabels: ['model-2', 'model-1', 'model-1', 'model-1'],
      computerUseEnabled: true,
      useLoggedInServices: true,
      budgetLimit: 5,
    });
    const prepareCallOrder = (params.prepareStreaming as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];
    const runTaskCallOrder = (params.runTask as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];
    expect(prepareCallOrder).toBeDefined();
    expect(runTaskCallOrder).toBeDefined();
    expect(prepareCallOrder as number).toBeLessThan(runTaskCallOrder as number);
    expect(params.runTask).toHaveBeenCalledWith({
      prompt: 'hello',
      demo: false,
      modelId: 'model-1',
      role_models: { Researcher: 'model-2' },
      projectId: 3,
      budget: 5,
      options: {
        agentCount: 4,
        computerUseEnabled: true,
        useLoggedInServices: true,
        quickModeEnabled: false,
        autonomyEnabled: true,
      },
      attachment_ids: ['file-1'],
    });
    expect(params.startStreaming).toHaveBeenCalledWith({
      taskId: 'task-1',
      conversationId: 'local-conversation',
      prompt: 'hello',
      agentCount: 4,
      agentLabels: ['model-2', 'model-1', 'model-1', 'model-1'],
      computerUseEnabled: true,
      useLoggedInServices: true,
      budgetLimit: 5,
      onConversationId: params.onConversationId,
      onApproval: expect.any(Function),
    });
    expect(params.failPreparedStreaming).not.toHaveBeenCalled();

    const streamOptions = (params.startStreaming as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    streamOptions?.onApproval?.({ id: 'approval-1' } as any);
    expect(params.onApproval).toHaveBeenCalledWith('task-1', { id: 'approval-1' });
  });

  it('fills agent labels with the selected model when role models are empty', async () => {
    const params = createSubmitStreamingParams({
      role_models: {},
      agentCount: 3,
    });

    await submitStreamingPrompt(params);

    expect(params.startStreaming).toHaveBeenCalledWith(
      expect.objectContaining({
        agentLabels: ['model-1', 'model-1', 'model-1'],
      })
    );
  });

  it('omits role model overrides when none are provided', async () => {
    const params = createSubmitStreamingParams({
      role_models: undefined,
    });

    await submitStreamingPrompt(params);

    expect(params.runTask).toHaveBeenCalledWith(
      expect.not.objectContaining({ role_models: expect.any(Object) })
    );
  });

  it('filters role model overrides and labels to active role slots', async () => {
    const params = createSubmitStreamingParams({
      agentCount: 2,
      role_models: {
        Researcher: 'model-research',
        Analyst: 'model-analysis',
        Skeptic: 'model-hidden',
        stale: 'model-stale',
      },
    });

    await submitStreamingPrompt(params);

    expect(params.runTask).toHaveBeenCalledWith(
      expect.objectContaining({
        role_models: {
          Researcher: 'model-research',
          Analyst: 'model-analysis',
        },
        options: expect.objectContaining({ agentCount: 2 }),
      })
    );
    expect(params.startStreaming).toHaveBeenCalledWith(
      expect.objectContaining({
        agentCount: 2,
        agentLabels: ['model-research', 'model-analysis'],
      })
    );
  });

  it('forwards MCP client tools in run payload options', async () => {
    const mcpToolItems = [
      {
        source: 'mcp' as const,
        serverName: 'filesystem',
        toolName: 'read_file',
        title: 'Read file',
        description: 'Read a workspace file',
      },
    ];
    const params = createSubmitStreamingParams({ mcpToolItems });

    await submitStreamingPrompt(params);

    expect(params.runTask).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          clientTools: {
            mcp: mcpToolItems,
          },
        }),
      })
    );
  });

  it('forwards selected research workflow in run payload options', async () => {
    const researchWorkflow: ResearchWorkflowOption = {
      workflow: 'investment_dossier',
      requiredCitations: true,
      preferredExports: ['docx', 'pdf'],
      sourcePolicy: 'public_and_attached',
    };
    const params = createSubmitStreamingParams({ researchWorkflow });

    await submitStreamingPrompt(params);

    expect(params.runTask).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          researchWorkflow,
        }),
      })
    );
  });

  it('only enables logged-in services when computer use is enabled', async () => {
    const params = createSubmitStreamingParams({
      computerUseEnabled: false,
      useLoggedInServices: true,
    });

    await submitStreamingPrompt(params);

    expect(params.runTask).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.not.objectContaining({
          useLoggedInServices: true,
        }),
      })
    );
    const preparedMetadata = (params.prepareStreaming as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0];
    expect(preparedMetadata).toEqual(expect.objectContaining({ computerUseEnabled: false }));
    expect(preparedMetadata).not.toHaveProperty('useLoggedInServices');
  });

  it('submitStreamingPrompt defaults omitted mode metadata to direct chat', async () => {
    const params = createSubmitStreamingParams({
      quickModeEnabled: undefined,
      computerUseEnabled: undefined,
      useLoggedInServices: undefined,
      agentCount: 4,
    });

    const result = await submitStreamingPrompt(params);

    expect(result).toEqual(ok({ type: 'streaming_started' }));
    expect(params.runTask).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          quickModeEnabled: true,
          agentCount: 1,
        }),
      })
    );
    expect(params.startStreaming).toHaveBeenCalledWith(
      expect.objectContaining({
        agentCount: 1,
      })
    );
  });

  it('submitStreamingPrompt queues when runTask throws while offline', async () => {
    const params = createSubmitStreamingParams({
      isOffline: vi.fn().mockReturnValue(true),
      runTask: vi.fn().mockRejectedValue(new Error('offline')),
    });

    const result = await submitStreamingPrompt(params);

    expect(result).toEqual(
      ok({ type: 'queued', message: 'Network error. Prompt saved locally for retry.' })
    );
    expect(params.logger.warn).toHaveBeenCalledWith('Prompt submission failed before response', {
      error: expect.any(Error),
    });
    expect(params.enqueuePrompt).toHaveBeenCalledWith(
      'local-conversation',
      'hello',
      expect.objectContaining({ prompt: 'hello', modelId: 'model-1' })
    );
  });

  it('submitStreamingPrompt returns generic error if offline queueing fails', async () => {
    const params = createSubmitStreamingParams({
      isOffline: vi.fn().mockReturnValue(true),
      runTask: vi.fn().mockRejectedValue(new Error('offline')),
      enqueuePrompt: vi.fn().mockRejectedValue(new Error('storage failed')),
    });

    const result = await submitStreamingPrompt(params);

    expect(result).toEqual(
      err({
        kind: 'error',
        message: 'Something went wrong while sending your message. Please try again.',
      })
    );
  });

  it('submitStreamingPrompt maps rate limits and network errors', async () => {
    const rateLimited = createSubmitStreamingParams({
      runTask: vi.fn().mockResolvedValue(
        err({
          kind: 'rate_limit',
          message: 'limited',
          resetTime: '2030-01-01',
        })
      ),
    });
    const networkOffline = createSubmitStreamingParams({
      isOffline: vi.fn().mockReturnValue(true),
      runTask: vi.fn().mockResolvedValue(err({ kind: 'network', message: 'offline' })),
    });
    const serverError = createSubmitStreamingParams({
      runTask: vi.fn().mockResolvedValue(err({ kind: 'server', message: 'server down' })),
    });

    await expect(submitStreamingPrompt(rateLimited)).resolves.toEqual(
      ok({ type: 'rate_limit', message: 'Rate limited', resetTime: '2030-01-01' })
    );
    await expect(submitStreamingPrompt(networkOffline)).resolves.toEqual(
      ok({ type: 'queued', message: 'Network error. Prompt saved locally for retry.' })
    );
    await expect(submitStreamingPrompt(serverError)).resolves.toEqual(
      err({ kind: 'error', message: 'server down' })
    );
  });

  it('submitStreamingPrompt queues when streaming fails or the device goes offline', async () => {
    const streamingFailed = createSubmitStreamingParams({
      startStreaming: vi.fn().mockRejectedValue(new Error('Streaming failed')),
    });
    const offlineDuringStream = createSubmitStreamingParams({
      isOffline: vi.fn().mockReturnValue(true),
      startStreaming: vi.fn().mockRejectedValue(new Error('socket closed')),
    });
    const storageFailure = createSubmitStreamingParams({
      startStreaming: vi.fn().mockRejectedValue(new Error('Streaming failed')),
      enqueuePrompt: vi.fn().mockRejectedValue(new Error('storage failed')),
    });

    await expect(submitStreamingPrompt(streamingFailed)).resolves.toEqual(
      ok({
        type: 'queued',
        message:
          'We lost the connection before the response could stream. Your prompt is saved and will retry automatically.',
      })
    );
    await expect(submitStreamingPrompt(offlineDuringStream)).resolves.toEqual(
      ok({ type: 'queued', message: 'Network error. Prompt saved locally for retry.' })
    );
    await expect(submitStreamingPrompt(storageFailure)).resolves.toEqual(
      err({
        kind: 'error',
        message: 'Something went wrong while sending your message. Please try again.',
      })
    );
  });

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
});
