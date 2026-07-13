import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { ApiClientError } from '@taskforceai/api-client/client';

import { executeSendMessage, resolvePromptContent } from './send-message';
import type { SendMessageRuntimeOptions } from './send-message';

const createOptions = (
  overrides: Partial<SendMessageRuntimeOptions> = {}
): SendMessageRuntimeOptions => ({
  content: ' hello ',
  metadata: {
    modelId: 'model-1',
    quickModeEnabled: true,
    computerUseEnabled: true,
    budget: 12,
    agentCount: 2,
  },
  attachmentIds: [],
  isOnline: true,
  addVisibleUserMessage: vi.fn().mockResolvedValue(undefined),
  ensureConversationId: vi.fn().mockResolvedValue('local-conversation'),
  setErrorMessage: vi.fn(),
  clearErrorMessage: vi.fn(),
  startStreaming: vi.fn().mockResolvedValue(undefined),
  enqueuePrompt: vi.fn().mockResolvedValue(undefined),
  invalidatePendingPrompts: vi.fn(),
  runTask: vi.fn().mockResolvedValue({ task_id: 'task-1' }),
  appendAssistantMessage: vi.fn().mockResolvedValue(undefined),
  handleLocalCommand: vi.fn().mockResolvedValue(false),
  handleApproval: vi.fn().mockResolvedValue(undefined),
  logger: { error: vi.fn() },
  ...overrides,
});

const expectedDefaultRunPayload = {
  prompt: ' hello ',
  demo: false,
  modelId: 'model-1',
  budget: 12,
  options: {
    quickModeEnabled: true,
    computerUseEnabled: true,
    agentCount: 1,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('send-message runtime', () => {
  it('resolves attachment-only prompt and display text', () => {
    expect(resolvePromptContent('   ', ['a'])).toEqual({
      promptForTask: 'Please analyze the attached file(s).',
      displayContent: '[Attached 1 file]',
    });
    expect(resolvePromptContent('', ['a', 'b'])).toEqual({
      promptForTask: 'Please analyze the attached file(s).',
      displayContent: '[Attached 2 files]',
    });
    expect(resolvePromptContent(' keep spacing ', [])).toEqual({
      promptForTask: ' keep spacing ',
      displayContent: ' keep spacing ',
    });
  });

  it('blocks attachment sends while offline before mutating conversation state', async () => {
    const options = createOptions({
      isOnline: false,
      attachmentIds: ['file-1'],
    });

    await executeSendMessage(options);

    expect(options.setErrorMessage).toHaveBeenCalledWith(
      'Cannot send attachments while offline. Please reconnect.'
    );
    expect(options.addVisibleUserMessage).not.toHaveBeenCalled();
    expect(options.clearErrorMessage).not.toHaveBeenCalled();
  });

  it('queues offline text prompts and invalidates pending prompts', async () => {
    const options = createOptions({
      isOnline: false,
      attachmentIds: undefined,
    });

    await executeSendMessage(options);

    expect(options.addVisibleUserMessage).toHaveBeenCalledWith(' hello ');
    expect(options.enqueuePrompt).toHaveBeenCalledWith(
      'local-conversation',
      ' hello ',
      expectedDefaultRunPayload
    );
    expect(options.invalidatePendingPrompts).toHaveBeenCalled();
    expect(options.runTask).not.toHaveBeenCalled();
    expect(options.setErrorMessage).toHaveBeenCalledWith(
      'Network error. Prompt saved locally for retry.'
    );
  });

  it('uses the offline retry message when first offline queue write fails and recovery succeeds', async () => {
    const options = createOptions({
      isOnline: false,
      attachmentIds: undefined,
      enqueuePrompt: vi
        .fn()
        .mockRejectedValueOnce(new Error('storage busy'))
        .mockResolvedValueOnce(undefined),
    });

    await executeSendMessage(options);

    expect(options.enqueuePrompt).toHaveBeenCalledTimes(2);
    expect(options.setErrorMessage).toHaveBeenCalledWith(
      'Network error. Prompt saved locally for retry.'
    );
  });

  it('starts streaming for task responses with runtime options', async () => {
    const handleApproval = vi.fn();
    const options = createOptions({ handleApproval });

    await executeSendMessage(options);

    expect(options.runTask).toHaveBeenCalledWith(expectedDefaultRunPayload);
    expect(options.startStreaming).toHaveBeenCalledWith({
      taskId: 'task-1',
      conversationId: 'local-conversation',
      prompt: ' hello ',
      agentCount: 1,
      computerUseEnabled: true,
      budgetLimit: 12,
      onApproval: expect.any(Function),
    });
    const streamOptions = (options.startStreaming as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    await streamOptions?.onApproval?.({ id: 'approval-1' } as any);
    expect(handleApproval).toHaveBeenCalledWith('task-1', { id: 'approval-1' });
  });

  it('marks private chat run requests for server-side no-training handling', async () => {
    const options = createOptions({
      metadata: {
        modelId: 'model-1',
        quickModeEnabled: true,
        privateChat: true,
      },
    });

    await executeSendMessage(options);

    expect(options.runTask).toHaveBeenCalledWith(
      expect.objectContaining({
        private_chat: true,
      })
    );
  });

  it('forwards reasoning effort in mobile run requests', async () => {
    const options = createOptions({
      metadata: {
        modelId: 'openai/gpt-5.6-sol',
        reasoningEffort: 'max',
      },
    });

    await executeSendMessage(options);

    expect(options.runTask).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: 'openai/gpt-5.6-sol',
        reasoningEffort: 'max',
      })
    );
  });

  it('blocks offline private chat before mutating or queueing conversation state', async () => {
    const options = createOptions({
      isOnline: false,
      attachmentIds: undefined,
      metadata: {
        modelId: 'model-1',
        privateChat: true,
      },
    });

    await executeSendMessage(options);

    expect(options.setErrorMessage).toHaveBeenCalledWith(
      'Private Chat is unavailable offline. Reconnect to send.'
    );
    expect(options.addVisibleUserMessage).not.toHaveBeenCalled();
    expect(options.ensureConversationId).not.toHaveBeenCalled();
    expect(options.enqueuePrompt).not.toHaveBeenCalled();
    expect(options.runTask).not.toHaveBeenCalled();
  });

  it('forwards MCP client tools in task options', async () => {
    const mcpToolItems = [
      {
        source: 'mcp' as const,
        serverName: 'filesystem',
        toolName: 'read_file',
        title: 'Read file',
        description: 'Read a workspace file',
      },
    ];
    const options = createOptions({ mcpToolItems });

    await executeSendMessage(options);

    expect(options.runTask).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          clientTools: {
            mcp: mcpToolItems,
          },
        }),
      })
    );
  });

  it('does not queue offline prompts that require MCP client tools', async () => {
    const mcpToolItems = [
      {
        source: 'mcp' as const,
        serverName: 'filesystem',
        toolName: 'read_file',
        title: 'Read file',
        description: 'Read a workspace file',
      },
    ];
    const options = createOptions({
      isOnline: false,
      attachmentIds: undefined,
      mcpToolItems,
    });

    await executeSendMessage(options);

    expect(options.enqueuePrompt).not.toHaveBeenCalled();
    expect(options.invalidatePendingPrompts).not.toHaveBeenCalled();
    expect(options.runTask).not.toHaveBeenCalled();
    expect(options.setErrorMessage).toHaveBeenCalledWith(
      'Prompts that use local MCP tools are unavailable offline. Reconnect to send.'
    );
  });

  it('defaults omitted mode metadata to direct chat', async () => {
    const options = createOptions({ metadata: undefined });

    await executeSendMessage(options);

    expect(options.runTask).toHaveBeenCalledWith({
      prompt: ' hello ',
      demo: false,
      options: {
        quickModeEnabled: true,
        agentCount: 1,
      },
    });
    expect(options.startStreaming).toHaveBeenCalledWith(
      expect.objectContaining({
        agentCount: 1,
      })
    );
  });

  it('appends immediate task results when no stream task id is returned', async () => {
    const options = createOptions({
      runTask: vi.fn().mockResolvedValue({ task_id: '', result: 'done' }),
    });

    await executeSendMessage(options);

    expect(options.appendAssistantMessage).toHaveBeenCalledWith({
      conversationId: 'local-conversation',
      content: 'done',
    });
    expect(options.startStreaming).not.toHaveBeenCalled();
  });

  it('appends inline completed results before starting a terminal stream', async () => {
    const options = createOptions({
      runTask: vi.fn().mockResolvedValue({
        task_id: 'task-inline',
        status: 'completed',
        result: 'inline done',
      }),
    });

    await executeSendMessage(options);

    expect(options.appendAssistantMessage).toHaveBeenCalledWith({
      conversationId: 'local-conversation',
      content: 'inline done',
    });
    expect(options.startStreaming).not.toHaveBeenCalled();
  });

  it('lets local commands short-circuit network submission', async () => {
    const options = createOptions({
      handleLocalCommand: vi.fn().mockResolvedValue(true),
    });

    await executeSendMessage(options);

    expect(options.handleLocalCommand).toHaveBeenCalledWith({
      prompt: ' hello ',
      attachmentIds: [],
    });
    expect(options.runTask).not.toHaveBeenCalled();
  });

  it('lets local commands run while offline before queueing', async () => {
    const options = createOptions({
      isOnline: false,
      attachmentIds: undefined,
      handleLocalCommand: vi.fn().mockResolvedValue(true),
    });

    await executeSendMessage(options);

    expect(options.handleLocalCommand).toHaveBeenCalledWith({
      prompt: ' hello ',
    });
    expect(options.enqueuePrompt).not.toHaveBeenCalled();
    expect(options.runTask).not.toHaveBeenCalled();
    expect(options.setErrorMessage).not.toHaveBeenCalledWith(
      'Network error. Prompt saved locally for retry.'
    );
  });

  it('maps rate limit API errors and parses string reset payloads', async () => {
    const options = createOptions({
      runTask: vi
        .fn()
        .mockRejectedValue(new ApiClientError(429, '{"resetTime":"2030-01-01"}', 'limited')),
    });

    await executeSendMessage(options);

    expect(options.setErrorMessage).toHaveBeenCalledWith(
      'You have reached your message limit. Please upgrade to Pro for more messages or wait for your limit to reset.',
      '2030-01-01'
    );
    expect(options.enqueuePrompt).not.toHaveBeenCalled();
  });

  it('maps rate limit API errors with object reset payloads', async () => {
    const options = createOptions({
      runTask: vi
        .fn()
        .mockRejectedValue(new ApiClientError(429, { resetTime: 1234567890 }, 'limited')),
    });

    await executeSendMessage(options);

    expect(options.setErrorMessage).toHaveBeenCalledWith(
      'You have reached your message limit. Please upgrade to Pro for more messages or wait for your limit to reset.',
      '1234567890'
    );
    expect(options.enqueuePrompt).not.toHaveBeenCalled();
  });

  it('maps rate limit API errors with non-object string bodies', async () => {
    const options = createOptions({
      runTask: vi.fn().mockRejectedValue(new ApiClientError(429, 'null', 'limited')),
    });

    await executeSendMessage(options);

    expect(options.setErrorMessage).toHaveBeenCalledWith(
      'You have reached your message limit. Please upgrade to Pro for more messages or wait for your limit to reset.',
      undefined
    );
    expect(options.enqueuePrompt).not.toHaveBeenCalled();
  });

  it('maps rate limit API errors with malformed JSON bodies', async () => {
    const options = createOptions({
      runTask: vi.fn().mockRejectedValue(new ApiClientError(429, '{invalid', 'limited')),
    });

    await executeSendMessage(options);

    expect(options.setErrorMessage).toHaveBeenCalledWith(
      'You have reached your message limit. Please upgrade to Pro for more messages or wait for your limit to reset.',
      undefined
    );
    expect(options.enqueuePrompt).not.toHaveBeenCalled();
  });

  it('queues prompts for retry when service errors occur', async () => {
    const options = createOptions({
      runTask: vi.fn().mockRejectedValue(new ApiClientError(503, {}, 'temporarily unavailable')),
    });

    await executeSendMessage(options);

    expect(options.enqueuePrompt).toHaveBeenCalledWith(
      'local-conversation',
      ' hello ',
      expectedDefaultRunPayload
    );
    expect(options.invalidatePendingPrompts).toHaveBeenCalled();
    expect(options.setErrorMessage).toHaveBeenCalledWith(
      'The service is temporarily unavailable. Your prompt is saved and will retry automatically.'
    );
  });

  it('does not queue MCP client tool prompts for retry when service errors occur', async () => {
    const options = createOptions({
      mcpToolItems: [
        {
          source: 'mcp' as const,
          serverName: 'filesystem',
          toolName: 'read_file',
          title: 'Read file',
          description: 'Read a workspace file',
        },
      ],
      runTask: vi.fn().mockRejectedValue(new ApiClientError(503, {}, 'temporarily unavailable')),
    });

    await executeSendMessage(options);

    expect(options.enqueuePrompt).not.toHaveBeenCalled();
    expect(options.invalidatePendingPrompts).not.toHaveBeenCalled();
    expect(options.setErrorMessage).toHaveBeenCalledWith(
      'Prompts that use local MCP tools require a live approval session. This prompt was not saved for retry.'
    );
  });

  it('does not queue private chat prompts for retry when service errors occur', async () => {
    const options = createOptions({
      metadata: {
        modelId: 'model-1',
        privateChat: true,
      },
      runTask: vi.fn().mockRejectedValue(new ApiClientError(503, {}, 'temporarily unavailable')),
    });

    await executeSendMessage(options);

    expect(options.enqueuePrompt).not.toHaveBeenCalled();
    expect(options.invalidatePendingPrompts).not.toHaveBeenCalled();
    expect(options.setErrorMessage).toHaveBeenCalledWith(
      'Private Chat could not send. This prompt was not saved for retry.'
    );
  });

  it('surfaces non-retryable API errors without queueing', async () => {
    const options = createOptions({
      runTask: vi.fn().mockRejectedValue(new ApiClientError(400, {}, 'invalid prompt')),
    });

    await executeSendMessage(options);

    expect(options.setErrorMessage).toHaveBeenCalledWith('invalid prompt');
    expect(options.enqueuePrompt).not.toHaveBeenCalled();
  });

  it('queues unexpected errors with the online retry message', async () => {
    const options = createOptions({
      runTask: vi.fn().mockRejectedValue(new Error('socket closed')),
      isOnline: true,
    });

    await executeSendMessage(options);

    expect(options.enqueuePrompt).toHaveBeenCalledWith(
      'local-conversation',
      ' hello ',
      expectedDefaultRunPayload
    );
    expect(options.setErrorMessage).toHaveBeenCalledWith(
      'We lost the connection before the response could stream. Your prompt is saved and will retry automatically.'
    );
  });

  it('does not queue private chat prompts for retry when unexpected errors occur', async () => {
    const options = createOptions({
      metadata: {
        privateChat: true,
      },
      runTask: vi.fn().mockRejectedValue(new Error('socket closed')),
      isOnline: true,
    });

    await executeSendMessage(options);

    expect(options.enqueuePrompt).not.toHaveBeenCalled();
    expect(options.invalidatePendingPrompts).not.toHaveBeenCalled();
    expect(options.setErrorMessage).toHaveBeenCalledWith(
      'Private Chat could not send. This prompt was not saved for retry.'
    );
  });

  it('falls back to generic error when conversation lookup fails during recovery', async () => {
    const options = createOptions({
      ensureConversationId: vi
        .fn()
        .mockRejectedValueOnce(new Error('initial failure'))
        .mockRejectedValueOnce(new Error('recovery failure')),
      runTask: vi.fn().mockRejectedValue(new Error('network')),
    });

    await executeSendMessage(options);

    expect(options.logger.error).toHaveBeenCalledWith(
      'Failed to retrieve conversation during error handling',
      expect.any(Object)
    );
    expect(options.setErrorMessage).toHaveBeenCalledWith('Something went wrong. Please try again.');
  });
});
