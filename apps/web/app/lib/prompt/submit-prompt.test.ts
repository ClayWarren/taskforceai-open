import { beforeEach, describe, expect, it, vi } from 'bun:test';

import { err, ok } from '@taskforceai/client-core/result';
import { StreamingConnectionError } from '@taskforceai/client-runtime';

const runTaskMock = vi.fn();
const loggerWarnMock = vi.fn();

void vi.mock('@taskforceai/api-client/api/tasks', () => ({
  runTask: runTaskMock,
}));

void vi.mock('../logger', () => ({
  logger: {
    warn: loggerWarnMock,
  },
}));

import { submitPrompt } from './submit-prompt';

type SubmitPromptParams = Parameters<typeof submitPrompt>[0];

const createParams = (overrides: Partial<SubmitPromptParams> = {}): SubmitPromptParams => ({
  prompt: 'Ship this',
  ensureConversationId: vi.fn(async () => 'remote-42'),
  enqueuePrompt: vi.fn(async () => {}),
  prepareStreaming: vi.fn(),
  failPreparedStreaming: vi.fn(),
  startStreaming: vi.fn(async () => {}),
  onSendMessage: vi.fn(),
  onConversationId: vi.fn(),
  buildRateLimitMessage: vi.fn(() => 'Rate limit reached for your plan'),
  readRateLimitResetTime: vi.fn(() => '2026-02-10T09:00:00.000Z'),
  isOffline: vi.fn(() => false),
  ...overrides,
});

describe('submitPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts streaming and forwards full payload when run succeeds', async () => {
    runTaskMock.mockResolvedValue(ok({ task_id: 'task-1' }));
    const params = createParams({
      modelId: 'gpt-5',
      role_models: { planner: 'gpt-5', coder: 'gpt-4.1' },
      projectId: 7,
      computerUseEnabled: true,
      attachment_ids: ['img-1', 'aud-1', 'vid-1'],
    });

    const result = await submitPrompt(params);

    expect(params.onSendMessage).toHaveBeenCalledWith('Ship this');
    expect(params.prepareStreaming).toHaveBeenCalledWith({
      conversationId: 'remote-42',
      prompt: 'Ship this',
      agentCount: 1,
      computerUseEnabled: true,
      useLoggedInServices: undefined,
      budgetLimit: undefined,
    });
    expect(runTaskMock).toHaveBeenCalledWith({
      prompt: 'Ship this',
      demo: false,
      modelId: 'gpt-5',
      projectId: 7,
      options: {
        agentCount: 1,
        computerUseEnabled: true,
        quickModeEnabled: true,
      },
      attachment_ids: ['img-1', 'aud-1', 'vid-1'],
    });
    expect(params.startStreaming).toHaveBeenCalledWith({
      taskId: 'task-1',
      conversationId: 'remote-42',
      prompt: 'Ship this',
      agentCount: 1,
      computerUseEnabled: true,
      budgetLimit: undefined,
      onApproval: undefined,
      onConversationId: params.onConversationId,
      useLoggedInServices: undefined,
    });
    expect(result).toEqual(ok({ type: 'streaming_started' }));
  });

  it('forwards logged-in services mode when computer use is enabled', async () => {
    runTaskMock.mockResolvedValue(ok({ task_id: 'task-logged-in' }));
    const params = createParams({
      computerUseEnabled: true,
      useLoggedInServices: true,
    });

    const result = await submitPrompt(params);

    expect(runTaskMock).toHaveBeenCalledWith({
      prompt: 'Ship this',
      demo: false,
      options: {
        agentCount: 1,
        computerUseEnabled: true,
        quickModeEnabled: true,
        useLoggedInServices: true,
      },
    });
    expect(params.startStreaming).toHaveBeenCalledWith({
      taskId: 'task-logged-in',
      conversationId: 'remote-42',
      prompt: 'Ship this',
      agentCount: 1,
      computerUseEnabled: true,
      useLoggedInServices: true,
      budgetLimit: undefined,
      onApproval: undefined,
      onConversationId: params.onConversationId,
    });
    expect(result).toEqual(ok({ type: 'streaming_started' }));
  });

  it('does not forward logged-in services when computer use is disabled', async () => {
    runTaskMock.mockResolvedValue(ok({ task_id: 'task-logged-out' }));
    const params = createParams({
      computerUseEnabled: false,
      useLoggedInServices: true,
    });

    const result = await submitPrompt(params);

    expect(runTaskMock).toHaveBeenCalledWith({
      prompt: 'Ship this',
      demo: false,
      options: {
        agentCount: 1,
        computerUseEnabled: false,
        quickModeEnabled: true,
      },
    });
    expect(params.startStreaming).toHaveBeenCalledWith({
      taskId: 'task-logged-out',
      conversationId: 'remote-42',
      prompt: 'Ship this',
      agentCount: 1,
      computerUseEnabled: false,
      budgetLimit: undefined,
      onApproval: undefined,
      onConversationId: params.onConversationId,
      useLoggedInServices: undefined,
    });
    expect(result).toEqual(ok({ type: 'streaming_started' }));
  });

  it('forwards available MCP client tools in run options', async () => {
    runTaskMock.mockResolvedValue(ok({ task_id: 'task-mcp-1' }));
    const params = createParams({
      mcpToolItems: [
        {
          source: 'mcp',
          serverName: 'docs',
          toolName: 'lookup',
          title: 'Lookup',
          description: 'Find docs',
        },
      ],
    });

    const result = await submitPrompt(params);

    expect(runTaskMock).toHaveBeenCalledWith({
      prompt: 'Ship this',
      demo: false,
      options: {
        agentCount: 1,
        clientTools: {
          mcp: [
            {
              source: 'mcp',
              serverName: 'docs',
              toolName: 'lookup',
              title: 'Lookup',
              description: 'Find docs',
            },
          ],
        },
        quickModeEnabled: true,
      },
    });
    expect(result).toEqual(ok({ type: 'streaming_started' }));
  });

  it('forwards selected research workflow in run options', async () => {
    runTaskMock.mockResolvedValue(ok({ task_id: 'task-research-1' }));
    const researchWorkflow = {
      workflow: 'investment_dossier',
      requiredCitations: true,
      preferredExports: ['docx', 'pdf'],
      sourcePolicy: 'public_and_attached',
    } satisfies SubmitPromptParams['researchWorkflow'];
    const params = createParams({ researchWorkflow });

    const result = await submitPrompt(params);

    expect(runTaskMock).toHaveBeenCalledWith({
      prompt: 'Ship this',
      demo: false,
      options: {
        agentCount: 1,
        quickModeEnabled: true,
        researchWorkflow,
      },
    });
    expect(result).toEqual(ok({ type: 'streaming_started' }));
  });

  it('forwards streaming approvals to the caller with the active task id', async () => {
    runTaskMock.mockResolvedValue(ok({ task_id: 'task-approval-1' }));
    const onApproval = vi.fn();
    const params = createParams({
      onApproval,
    });

    await submitPrompt(params);

    const startStreamingCall = (params.startStreaming as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0];
    expect(startStreamingCall?.onApproval).toBeDefined();

    startStreamingCall?.onApproval?.({
      permission: 'mcp.call',
      agentName: 'assistant',
      patterns: ['docs', 'lookup'],
      metadata: {
        source: 'mcp',
        action: 'tool_call',
        serverName: 'docs',
        toolName: 'lookup',
        arguments: {},
      },
    });

    expect(onApproval).toHaveBeenCalledWith('task-approval-1', expect.any(Object));
  });

  it('auto-routes image generation prompts to Gemini image model in quick mode', async () => {
    runTaskMock.mockResolvedValue(ok({ task_id: 'task-image-1' }));
    const params = createParams({
      prompt: 'Generate an image of a futuristic city skyline at sunset',
      modelId: 'openai/gpt-5',
      computerUseEnabled: true,
      quickModeEnabled: false,
    });

    const result = await submitPrompt(params);

    expect(runTaskMock).toHaveBeenCalledWith({
      prompt: 'Generate an image of a futuristic city skyline at sunset',
      demo: false,
      modelId: 'google/gemini-2.5-flash-image',
      options: {
        agentCount: 1,
        computerUseEnabled: false,
        quickModeEnabled: true,
      },
    });
    const imageStreamMetadata = (params.startStreaming as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0];
    expect(imageStreamMetadata).toEqual(
      expect.objectContaining({
        taskId: 'task-image-1',
        computerUseEnabled: false,
      })
    );
    expect(imageStreamMetadata).not.toHaveProperty('budgetLimit');
    expect(result).toEqual(ok({ type: 'streaming_started' }));
  });

  it('auto-routes image edit prompts when attachments are present', async () => {
    runTaskMock.mockResolvedValue(ok({ task_id: 'task-image-2' }));
    const params = createParams({
      prompt: 'Edit this image to remove background and improve lighting',
      attachment_ids: ['img-1'],
      modelId: 'anthropic/claude-opus',
      quickModeEnabled: false,
    });

    const result = await submitPrompt(params);

    expect(runTaskMock).toHaveBeenCalledWith({
      prompt: 'Edit this image to remove background and improve lighting',
      demo: false,
      modelId: 'google/gemini-2.5-flash-image',
      options: {
        agentCount: 1,
        computerUseEnabled: false,
        quickModeEnabled: true,
      },
      attachment_ids: ['img-1'],
    });
    const imageEditStreamMetadata = (params.startStreaming as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0];
    expect(imageEditStreamMetadata).toEqual(
      expect.objectContaining({
        taskId: 'task-image-2',
        computerUseEnabled: false,
      })
    );
    expect(imageEditStreamMetadata).not.toHaveProperty('budgetLimit');
    expect(result).toEqual(ok({ type: 'streaming_started' }));
  });

  it('queues prompt when run request throws and client is offline', async () => {
    runTaskMock.mockRejectedValue(new Error('socket hang up'));
    const params = createParams({
      isOffline: vi.fn(() => true),
    });

    const result = await submitPrompt(params);

    expect(loggerWarnMock).toHaveBeenCalled();
    expect(params.enqueuePrompt).toHaveBeenCalledWith('remote-42', 'Ship this', {
      prompt: 'Ship this',
      demo: false,
      options: {
        agentCount: 1,
        quickModeEnabled: true,
      },
    });
    expect(result).toEqual(
      ok({
        type: 'queued',
        message: 'Network error. Prompt saved locally for retry.',
      })
    );
  });

  it('queues full run payload when offline replay is needed', async () => {
    runTaskMock.mockRejectedValue(new Error('socket hang up'));
    const params = createParams({
      isOffline: vi.fn(() => true),
      modelId: 'gpt-5',
      role_models: { planner: 'gpt-5' },
      projectId: 7,
      computerUseEnabled: true,
      attachment_ids: ['img-1', 'aud-1', 'vid-1'],
    });

    await submitPrompt(params);

    expect(params.enqueuePrompt).toHaveBeenCalledWith('remote-42', 'Ship this', {
      prompt: 'Ship this',
      demo: false,
      modelId: 'gpt-5',
      projectId: 7,
      options: {
        agentCount: 1,
        computerUseEnabled: true,
        quickModeEnabled: true,
      },
      attachment_ids: ['img-1', 'aud-1', 'vid-1'],
    });
  });

  it('returns generic error when run request throws while online', async () => {
    runTaskMock.mockRejectedValue(new Error('unexpected'));
    const params = createParams({
      isOffline: vi.fn(() => false),
    });

    const result = await submitPrompt(params);

    expect(result).toEqual(
      err({
        kind: 'error',
        message: 'Something went wrong while sending your message. Please try again.',
      })
    );
  });

  it('returns rate-limit outcome including reset time when provided', async () => {
    runTaskMock.mockResolvedValue(
      err({
        kind: 'rate_limit',
        message: 'Too many requests',
      } as any)
    );
    const params = createParams();

    const result = await submitPrompt(params);

    expect(params.buildRateLimitMessage).toHaveBeenCalledWith(undefined);
    expect(params.readRateLimitResetTime).toHaveBeenCalled();
    expect(result).toEqual(
      ok({
        type: 'rate_limit',
        message: 'Rate limit reached for your plan',
        resetTime: '2026-02-10T09:00:00.000Z',
      })
    );
  });

  it('queues prompt for network errors returned by runTask while offline', async () => {
    runTaskMock.mockResolvedValue(
      err({
        kind: 'network',
        message: 'Network unavailable',
      } as any)
    );
    const params = createParams({
      isOffline: vi.fn(() => true),
    });

    const result = await submitPrompt(params);

    expect(params.enqueuePrompt).toHaveBeenCalledWith('remote-42', 'Ship this', {
      prompt: 'Ship this',
      demo: false,
      options: {
        agentCount: 1,
        quickModeEnabled: true,
      },
    });
    expect(result).toEqual(
      ok({
        type: 'queued',
        message: 'Network error. Prompt saved locally for retry.',
      })
    );
  });

  it('returns runTask error message for non-network non-rate-limit failures', async () => {
    runTaskMock.mockResolvedValue(
      err({
        kind: 'server',
        message: 'Server exploded',
      } as any)
    );
    const params = createParams();

    const result = await submitPrompt(params);

    expect(result).toEqual(
      err({
        kind: 'error',
        message: 'Server exploded',
      })
    );
  });

  it('forces quick mode requests to single-agent orchestration', async () => {
    runTaskMock.mockResolvedValue(ok({ task_id: 'task-quick-1' }));
    const params = createParams({
      quickModeEnabled: true,
      agentCount: 4,
    });

    const result = await submitPrompt(params);

    expect(runTaskMock).toHaveBeenCalledWith({
      prompt: 'Ship this',
      demo: false,
      options: {
        agentCount: 1,
        quickModeEnabled: true,
      },
    });
    expect(params.startStreaming).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-quick-1',
        agentCount: 1,
      })
    );
    expect(result).toEqual(ok({ type: 'streaming_started' }));
  });

  it('queues prompt when streaming bootstrap fails with explicit streaming failure', async () => {
    runTaskMock.mockResolvedValue(ok({ task_id: 'task-2' }));
    const params = createParams({
      ensureConversationId: vi.fn().mockResolvedValueOnce('remote-42'),
      startStreaming: vi.fn(async () => {
        throw new StreamingConnectionError({
          code: 'connection_failed',
          message: 'Streaming connection failed',
        });
      }),
    });

    const result = await submitPrompt(params);

    expect(params.ensureConversationId).toHaveBeenCalledTimes(1);
    expect(params.enqueuePrompt).toHaveBeenCalledWith('remote-42', 'Ship this', {
      prompt: 'Ship this',
      demo: false,
      options: {
        agentCount: 1,
        quickModeEnabled: true,
      },
    });
    expect(result).toEqual(
      ok({
        type: 'queued',
        message:
          'We lost the connection before the response could stream. Your prompt is saved and will retry automatically.',
      })
    );
  });

  it('queues prompt when streaming bootstrap fails and device is offline', async () => {
    runTaskMock.mockResolvedValue(ok({ task_id: 'task-3' }));
    const params = createParams({
      ensureConversationId: vi
        .fn()
        .mockResolvedValueOnce('remote-42')
        .mockResolvedValueOnce('remote-42'),
      isOffline: vi.fn(() => true),
      startStreaming: vi.fn(async () => {
        throw new Error('socket closed');
      }),
    });

    const result = await submitPrompt(params);

    expect(params.enqueuePrompt).toHaveBeenCalledWith('remote-42', 'Ship this', {
      prompt: 'Ship this',
      demo: false,
      options: {
        agentCount: 1,
        quickModeEnabled: true,
      },
    });
    expect(result).toEqual(
      ok({
        type: 'queued',
        message: 'Network error. Prompt saved locally for retry.',
      })
    );
  });

  it('returns generic error when streaming bootstrap fails while online', async () => {
    runTaskMock.mockResolvedValue(ok({ task_id: 'task-4' }));
    const params = createParams({
      isOffline: vi.fn(() => false),
      startStreaming: vi.fn(async () => {
        throw new Error('bad stream state');
      }),
    });

    const result = await submitPrompt(params);

    expect(result).toEqual(
      err({
        kind: 'error',
        message: 'Something went wrong while sending your message. Please try again.',
      })
    );
  });
});
