import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { err, ok } from '@taskforceai/client-core/result';
import type { ResearchWorkflowOption } from '@taskforceai/client-core';

import { submitStreamingPrompt } from './prompt-submission';
import { createSubmitStreamingParams } from './prompt-submission.test-harness';
import { StreamingConnectionError } from './streaming-errors';

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
    expect(params.onApproval).toHaveBeenCalledWith('task-1', {
      id: 'approval-1',
    });
  });

  it('submitStreamingPrompt marks private chats in the run payload', async () => {
    const params = createSubmitStreamingParams({ privateChat: true });

    await submitStreamingPrompt(params);

    expect(params.runTask).toHaveBeenCalledWith(
      expect.objectContaining({
        private_chat: true,
      })
    );
  });

  it('forwards selected reasoning effort with the selected model', async () => {
    const params = createSubmitStreamingParams({ reasoningEffort: 'xhigh' });

    await submitStreamingPrompt(params);

    expect(params.runTask).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: 'model-1',
        reasoningEffort: 'xhigh',
      })
    );
  });

  it('submitStreamingPrompt does not queue private chats while offline', async () => {
    const params = createSubmitStreamingParams({
      privateChat: true,
      isOffline: vi.fn().mockReturnValue(true),
    });

    const result = await submitStreamingPrompt(params);

    expect(result).toEqual(
      err({
        kind: 'error',
        message: 'Private Chat could not send. This prompt was not saved for retry.',
      })
    );
    expect(params.onSendMessage).not.toHaveBeenCalled();
    expect(params.prepareStreaming).not.toHaveBeenCalled();
    expect(params.ensureConversationId).not.toHaveBeenCalled();
    expect(params.runTask).not.toHaveBeenCalled();
    expect(params.enqueuePrompt).not.toHaveBeenCalled();
    expect(params.failPreparedStreaming).toHaveBeenCalledWith(
      'Private Chat could not send. This prompt was not saved for retry.'
    );
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

  it('preserves agent label slots when only a later role has a model override', async () => {
    const params = createSubmitStreamingParams({
      agentCount: 2,
      modelId: null,
      role_models: {
        Analyst: 'model-analysis',
      },
    });

    await submitStreamingPrompt(params);

    expect(params.runTask).toHaveBeenCalledWith(
      expect.objectContaining({
        role_models: {
          Analyst: 'model-analysis',
        },
      })
    );
    expect(params.startStreaming).toHaveBeenCalledWith(
      expect.objectContaining({
        agentCount: 2,
        agentLabels: ['', 'model-analysis'],
      })
    );
  });

  it('omits agent labels when no role or fallback models are available', async () => {
    const params = createSubmitStreamingParams({
      agentCount: 2,
      modelId: null,
      role_models: {},
    });

    await submitStreamingPrompt(params);

    expect(params.prepareStreaming).toHaveBeenCalledWith(
      expect.not.objectContaining({ agentLabels: expect.any(Array) })
    );
    expect(params.startStreaming).toHaveBeenCalledWith(
      expect.not.objectContaining({ agentLabels: expect.any(Array) })
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

  it('does not queue MCP client tool prompts when offline submission fails', async () => {
    const params = createSubmitStreamingParams({
      isOffline: vi.fn().mockReturnValue(true),
      runTask: vi.fn().mockRejectedValue(new Error('offline')),
      mcpToolItems: [
        {
          source: 'mcp' as const,
          serverName: 'filesystem',
          toolName: 'read_file',
          title: 'Read file',
          description: 'Read a workspace file',
        },
      ],
    });

    const result = await submitStreamingPrompt(params);

    expect(result).toEqual(
      err({
        kind: 'error',
        message:
          'Prompts that use local MCP tools require a live approval session. This prompt was not saved for retry.',
      })
    );
    expect(params.enqueuePrompt).not.toHaveBeenCalled();
    expect(params.failPreparedStreaming).toHaveBeenCalledWith(
      'Prompts that use local MCP tools require a live approval session. This prompt was not saved for retry.'
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
      ok({
        type: 'queued',
        message: 'Network error. Prompt saved locally for retry.',
      })
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
      ok({
        type: 'rate_limit',
        message: 'Rate limited',
        resetTime: '2030-01-01',
      })
    );
    await expect(submitStreamingPrompt(networkOffline)).resolves.toEqual(
      ok({
        type: 'queued',
        message: 'Network error. Prompt saved locally for retry.',
      })
    );
    await expect(submitStreamingPrompt(serverError)).resolves.toEqual(
      err({ kind: 'error', message: 'server down' })
    );
  });

  it('submitStreamingPrompt returns generic error if offline network failure queueing fails', async () => {
    const params = createSubmitStreamingParams({
      isOffline: vi.fn().mockReturnValue(true),
      runTask: vi.fn().mockResolvedValue(err({ kind: 'network', message: 'offline' })),
      enqueuePrompt: vi.fn().mockRejectedValue(new Error('storage failed')),
    });

    await expect(submitStreamingPrompt(params)).resolves.toEqual(
      err({
        kind: 'error',
        message: 'Something went wrong while sending your message. Please try again.',
      })
    );
    expect(params.failPreparedStreaming).toHaveBeenCalledWith(
      'Something went wrong while sending your message. Please try again.'
    );
  });

  it('does not queue MCP client tool prompts after offline network task failures', async () => {
    const params = createSubmitStreamingParams({
      isOffline: vi.fn().mockReturnValue(true),
      runTask: vi.fn().mockResolvedValue(err({ kind: 'network', message: 'offline' })),
      mcpToolItems: [
        {
          source: 'mcp' as const,
          serverName: 'filesystem',
          toolName: 'read_file',
          title: 'Read file',
          description: 'Read a workspace file',
        },
      ],
    });

    await expect(submitStreamingPrompt(params)).resolves.toEqual(
      err({
        kind: 'error',
        message:
          'Prompts that use local MCP tools require a live approval session. This prompt was not saved for retry.',
      })
    );
    expect(params.enqueuePrompt).not.toHaveBeenCalled();
    expect(params.failPreparedStreaming).toHaveBeenCalledWith(
      'Prompts that use local MCP tools require a live approval session. This prompt was not saved for retry.'
    );
  });

  it('submitStreamingPrompt queues when streaming fails or the device goes offline', async () => {
    const streamingFailed = createSubmitStreamingParams({
      startStreaming: vi.fn().mockRejectedValue(
        new StreamingConnectionError({
          code: 'connection_failed',
          message: 'Streaming connection failed',
        })
      ),
    });
    const offlineDuringStream = createSubmitStreamingParams({
      isOffline: vi.fn().mockReturnValue(true),
      startStreaming: vi.fn().mockRejectedValue(new Error('socket closed')),
    });
    const storageFailure = createSubmitStreamingParams({
      startStreaming: vi.fn().mockRejectedValue(
        new StreamingConnectionError({
          code: 'connection_failed',
          message: 'Streaming connection failed',
        })
      ),
      enqueuePrompt: vi.fn().mockRejectedValue(new Error('storage failed')),
    });
    const rawMessageOnlyFailure = createSubmitStreamingParams({
      startStreaming: vi.fn().mockRejectedValue(new Error('Streaming failed')),
    });

    await expect(submitStreamingPrompt(streamingFailed)).resolves.toEqual(
      ok({
        type: 'queued',
        message:
          'We lost the connection before the response could stream. Your prompt is saved and will retry automatically.',
      })
    );
    await expect(submitStreamingPrompt(offlineDuringStream)).resolves.toEqual(
      ok({
        type: 'queued',
        message: 'Network error. Prompt saved locally for retry.',
      })
    );
    await expect(submitStreamingPrompt(storageFailure)).resolves.toEqual(
      err({
        kind: 'error',
        message: 'Something went wrong while sending your message. Please try again.',
      })
    );
    await expect(submitStreamingPrompt(rawMessageOnlyFailure)).resolves.toEqual(
      err({
        kind: 'error',
        message: 'Something went wrong while sending your message. Please try again.',
      })
    );
    expect(rawMessageOnlyFailure.enqueuePrompt).not.toHaveBeenCalled();
  });

  it('does not queue MCP client tool prompts when streaming fails', async () => {
    const params = createSubmitStreamingParams({
      startStreaming: vi.fn().mockRejectedValue(
        new StreamingConnectionError({
          code: 'connection_failed',
          message: 'Streaming connection failed',
        })
      ),
      mcpToolItems: [
        {
          source: 'mcp' as const,
          serverName: 'filesystem',
          toolName: 'read_file',
          title: 'Read file',
          description: 'Read a workspace file',
        },
      ],
    });

    await expect(submitStreamingPrompt(params)).resolves.toEqual(
      err({
        kind: 'error',
        message:
          'Prompts that use local MCP tools require a live approval session. This prompt was not saved for retry.',
      })
    );
    expect(params.enqueuePrompt).not.toHaveBeenCalled();
    expect(params.failPreparedStreaming).toHaveBeenCalledWith(
      'Prompts that use local MCP tools require a live approval session. This prompt was not saved for retry.'
    );
  });

  it('submitStreamingPrompt does not queue private chats after network or streaming failures', async () => {
    const offlineAfterTaskFailure = createSubmitStreamingParams({
      privateChat: true,
      isOffline: vi.fn().mockReturnValueOnce(false).mockReturnValue(true),
      runTask: vi.fn().mockResolvedValue(err({ kind: 'network', message: 'offline' })),
    });
    const privateStreamingFailed = createSubmitStreamingParams({
      privateChat: true,
      startStreaming: vi.fn().mockRejectedValue(
        new StreamingConnectionError({
          code: 'connection_failed',
          message: 'Streaming connection failed',
        })
      ),
    });

    await expect(submitStreamingPrompt(offlineAfterTaskFailure)).resolves.toEqual(
      err({
        kind: 'error',
        message: 'Private Chat could not send. This prompt was not saved for retry.',
      })
    );
    await expect(submitStreamingPrompt(privateStreamingFailed)).resolves.toEqual(
      err({
        kind: 'error',
        message: 'Private Chat could not send. This prompt was not saved for retry.',
      })
    );
    expect(offlineAfterTaskFailure.enqueuePrompt).not.toHaveBeenCalled();
    expect(privateStreamingFailed.enqueuePrompt).not.toHaveBeenCalled();
    expect(offlineAfterTaskFailure.failPreparedStreaming).toHaveBeenCalledWith(
      'Private Chat could not send. This prompt was not saved for retry.'
    );
    expect(privateStreamingFailed.failPreparedStreaming).toHaveBeenCalledWith(
      'Private Chat could not send. This prompt was not saved for retry.'
    );
  });

  it('does not queue private chats after a thrown runTask failure while offline', async () => {
    const params = createSubmitStreamingParams({
      privateChat: true,
      isOffline: vi.fn().mockReturnValueOnce(false).mockReturnValue(true),
      runTask: vi.fn().mockRejectedValue(new Error('offline')),
    });

    await expect(submitStreamingPrompt(params)).resolves.toEqual(
      err({
        kind: 'error',
        message: 'Private Chat could not send. This prompt was not saved for retry.',
      })
    );
    expect(params.enqueuePrompt).not.toHaveBeenCalled();
    expect(params.failPreparedStreaming).toHaveBeenCalledWith(
      'Private Chat could not send. This prompt was not saved for retry.'
    );
  });
});
