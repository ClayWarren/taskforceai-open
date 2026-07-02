import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ApiClientError } from '@taskforceai/contracts/client';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { useMessageSender } from '../hooks/useMessageSender';
import { enqueuePrompt, upsertMessage } from '../storage/chat-local-mobile';
import type { Message } from '../types';

jest.mock('../logger', () => ({
  createModuleLogger: () => ({
    error: jest.fn(),
  }),
}));

jest.mock('../storage/chat-local-mobile', () => ({
  enqueuePrompt: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  upsertMessage: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
}));

jest.mock('../mcp/approval', () => ({
  fulfillPendingMcpApproval: jest.fn(async () => undefined),
}));

jest.mock('../mcp/local-command', () => ({
  handleMobileLocalMcpCommand: jest.fn(async () => null),
}));

type RunTaskResponse = {
  task_id: string;
  status?: string | null;
  cached?: boolean | null;
  result?: string | null;
  conversation_id?: string | null;
};

type RunTaskMutation = (input: {
  prompt: string;
  demo?: boolean;
  conversation_id?: string;
  projectId?: number;
  modelId?: string;
  budget?: number;
  attachment_ids?: string[];
  options?: Record<string, any>;
}) => Promise<RunTaskResponse>;

type ConversationOption = {
  onSendMessage: (content: string) => Promise<void>;
  ensureActiveConversation: () => Promise<string>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
};

type StreamingOption = {
  startStreaming: (options: { taskId: string; conversationId: string; prompt: string; computerUseEnabled?: boolean; budgetLimit?: number }) => Promise<void>;
  clearErrorMessage: () => void;
  setErrorMessage: (message: string, resetTime?: string) => void;
};

type MessageSenderOptions = {
  conversation: ConversationOption;
  streaming: StreamingOption;
  isOnline: boolean;
  triggerRunTask: RunTaskMutation;
  mcpManager?: unknown;
  mcpToolItems?: Array<{
    source: 'mcp';
    serverName: string;
    toolName: string;
    title: string;
    description: string;
  }>;
  invalidatePendingPrompts?: () => void;
};

const renderUseMessageSender = (options: MessageSenderOptions): {
  hook: ReturnType<typeof useMessageSender>;
  cleanup: () => void;
} => {
  let hookValue: ReturnType<typeof useMessageSender> | null = null;
  let renderer: TestRenderer.ReactTestRenderer | null = null;

  const Wrapper: React.FC = () => {
    hookValue = useMessageSender({
      ...options,
      mcpManager: (options.mcpManager ?? {}) as never,
    });
    return null;
  };

  act(() => {
    renderer = TestRenderer.create(<Wrapper />);
  });

  const cleanup = () => {
    act(() => {
      if (renderer) {
        renderer.unmount();
      }
    });
  };

  if (!hookValue || !renderer) {
    throw new Error('Hook did not initialize');
  }

  return { hook: hookValue, cleanup };
};

const createConversationMock = (): ConversationOption => ({
  onSendMessage: jest.fn<(content: string) => Promise<void>>().mockResolvedValue(undefined),
  ensureActiveConversation: jest
    .fn<() => Promise<string>>()
    .mockResolvedValue('conv-1'),
  setMessages: jest.fn(),
});

const createStreamingMock = (): StreamingOption => ({
  startStreaming: jest
    .fn<(options: { taskId: string; conversationId: string; prompt: string; computerUseEnabled?: boolean; budgetLimit?: number }) => Promise<void>>()
    .mockResolvedValue(undefined),
  clearErrorMessage: jest.fn(),
  setErrorMessage: jest.fn(),
});

describe('useMessageSender', () => {
  const enqueuePromptMock = jest.mocked(enqueuePrompt);
  const upsertMessageMock = jest.mocked(upsertMessage);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('queues prompts and surfaces error when offline', async () => {
    const conversation = createConversationMock();
    const streaming = createStreamingMock();
    const triggerRunTask = jest.fn<RunTaskMutation>();
    const invalidatePendingPrompts = jest.fn();

    const { hook, cleanup } = renderUseMessageSender({
      conversation,
      streaming,
      isOnline: false,
      triggerRunTask,
      invalidatePendingPrompts,
    });

    await hook.handleSendMessage('Hello offline');

    expect(conversation.onSendMessage).toHaveBeenCalledWith('Hello offline');
    expect(conversation.ensureActiveConversation).toHaveBeenCalled();
    expect(enqueuePromptMock).toHaveBeenCalledWith('conv-1', 'Hello offline', {
      prompt: 'Hello offline',
      demo: false,
      options: {
        quickModeEnabled: true,
        agentCount: 1,
      },
    });
    expect(streaming.setErrorMessage).toHaveBeenCalledWith(
      'Network error. Prompt saved locally for retry.'
    );
    expect(triggerRunTask).not.toHaveBeenCalled();
    expect(invalidatePendingPrompts).toHaveBeenCalled();
    cleanup();
  });

  it('does not persist a user message when attachments are sent offline', async () => {
    const conversation = createConversationMock();
    const streaming = createStreamingMock();
    const triggerRunTask = jest.fn<RunTaskMutation>();

    const { hook, cleanup } = renderUseMessageSender({
      conversation,
      streaming,
      isOnline: false,
      triggerRunTask,
    });

    await hook.handleSendMessage('offline with file', undefined, ['att-1']);

    expect(conversation.onSendMessage).not.toHaveBeenCalled();
    expect(conversation.ensureActiveConversation).not.toHaveBeenCalled();
    expect(enqueuePromptMock).not.toHaveBeenCalled();
    expect(streaming.setErrorMessage).toHaveBeenCalledWith(
      'Cannot send attachments while offline. Please reconnect.'
    );
    expect(triggerRunTask).not.toHaveBeenCalled();
    cleanup();
  });

  it('starts streaming when backend returns a task id', async () => {
    const conversation = createConversationMock();
    const streaming = createStreamingMock();
    const triggerRunTask = jest.fn<RunTaskMutation>().mockResolvedValue({ task_id: 'task-42' });

    const { hook, cleanup } = renderUseMessageSender({
      conversation,
      streaming,
      isOnline: true,
      triggerRunTask,
    });

    await hook.handleSendMessage('Stream it');

    expect(triggerRunTask).toHaveBeenCalledWith({
      prompt: 'Stream it',
      demo: false,
      options: {
        quickModeEnabled: true,
        agentCount: 1,
      },
    });
    expect(streaming.startStreaming).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-42',
        conversationId: 'conv-1',
        prompt: 'Stream it',
      })
    );
    expect(enqueuePromptMock).not.toHaveBeenCalled();
    cleanup();
  });

  it('includes available MCP client tools in run options', async () => {
    const conversation = createConversationMock();
    const streaming = createStreamingMock();
    const triggerRunTask = jest.fn<RunTaskMutation>().mockResolvedValue({ task_id: 'task-42' });

    const { hook, cleanup } = renderUseMessageSender({
      conversation,
      streaming,
      isOnline: true,
      triggerRunTask,
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

    await hook.handleSendMessage('Use local MCP');

    expect(triggerRunTask).toHaveBeenCalledWith({
      prompt: 'Use local MCP',
      demo: false,
      options: {
        quickModeEnabled: true,
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
      },
    });
    cleanup();
  });

  it('persists assistant response when no streaming task is returned', async () => {
    const conversation = createConversationMock();
    const streaming = createStreamingMock();
    const triggerRunTask = jest
      .fn<RunTaskMutation>()
      .mockResolvedValue({ task_id: '', result: 'Task done' });

    const { hook, cleanup } = renderUseMessageSender({
      conversation,
      streaming,
      isOnline: true,
      triggerRunTask,
    });

    await hook.handleSendMessage('Summarize');

    expect(conversation.setMessages).toHaveBeenCalled();
    expect(upsertMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        content: 'Task done',
        role: 'assistant',
        isStreaming: false,
      })
    );
    cleanup();
  });

  it('persists inline completed responses even when a task id is returned', async () => {
    const conversation = createConversationMock();
    const streaming = createStreamingMock();
    const triggerRunTask = jest
      .fn<RunTaskMutation>()
      .mockResolvedValue({ task_id: 'task-inline', status: 'completed', result: 'Hi there' });

    const { hook, cleanup } = renderUseMessageSender({
      conversation,
      streaming,
      isOnline: true,
      triggerRunTask,
    });

    await hook.handleSendMessage('Hi');

    expect(streaming.startStreaming).not.toHaveBeenCalled();
    expect(upsertMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        content: 'Hi there',
        role: 'assistant',
        isStreaming: false,
      })
    );
    cleanup();
  });

  it('surfaces rate limit errors with reset time when ApiClientError is thrown', async () => {
    const conversation = createConversationMock();
    const streaming = createStreamingMock();
    const rateLimitError = new ApiClientError(
      429,
      { resetTime: '2025-01-01T00:00:00Z' },
      'Limited'
    );
    const triggerRunTask = jest.fn<RunTaskMutation>().mockRejectedValue(rateLimitError);

    const { hook, cleanup } = renderUseMessageSender({
      conversation,
      streaming,
      isOnline: true,
      triggerRunTask,
    });

    await hook.handleSendMessage('Rate limit me');

    expect(streaming.setErrorMessage).toHaveBeenCalledWith(
      'You have reached your message limit. Please upgrade to Pro for more messages or wait for your limit to reset.',
      '2025-01-01T00:00:00Z'
    );
    expect(enqueuePromptMock).not.toHaveBeenCalled();
    cleanup();
  });

  it('queues prompt and reports fallback message on generic failures', async () => {
    const conversation = createConversationMock();
    const streaming = createStreamingMock();
    const triggerRunTask = jest.fn<RunTaskMutation>().mockRejectedValue(new Error('Network flake'));
    const invalidatePendingPrompts = jest.fn();

    const { hook, cleanup } = renderUseMessageSender({
      conversation,
      streaming,
      isOnline: true,
      triggerRunTask,
      invalidatePendingPrompts,
    });

    await hook.handleSendMessage('Hello again');

    expect(enqueuePromptMock).toHaveBeenCalledWith('conv-1', 'Hello again', {
      prompt: 'Hello again',
      demo: false,
      options: {
        quickModeEnabled: true,
        agentCount: 1,
      },
    });
    expect(streaming.setErrorMessage).toHaveBeenCalledWith(
      'We lost the connection before the response could stream. Your prompt is saved and will retry automatically.'
    );
    expect(invalidatePendingPrompts).toHaveBeenCalled();
    cleanup();
  });

  it('includes model metadata when invoking runTask', async () => {
    const conversation = createConversationMock();
    const streaming = createStreamingMock();
    const triggerRunTask = jest.fn<RunTaskMutation>().mockResolvedValue({ task_id: 'task-model' });

    const { hook, cleanup } = renderUseMessageSender({
      conversation,
      streaming,
      isOnline: true,
      triggerRunTask,
    });

    await hook.handleSendMessage('Model online', { modelId: 'openai/gpt-5.5' });

    expect(triggerRunTask).toHaveBeenCalledWith({
      prompt: 'Model online',
      demo: false,
      modelId: 'openai/gpt-5.5',
      options: {
        quickModeEnabled: true,
        agentCount: 1,
      },
    });
    cleanup();
  });

  it('includes computer use metadata when invoking runTask and starting streaming', async () => {
    const conversation = createConversationMock();
    const streaming = createStreamingMock();
    const triggerRunTask = jest.fn<RunTaskMutation>().mockResolvedValue({ task_id: 'task-computer' });

    const { hook, cleanup } = renderUseMessageSender({
      conversation,
      streaming,
      isOnline: true,
      triggerRunTask,
    });

    await hook.handleSendMessage('Use the computer', {
      quickModeEnabled: true,
      computerUseEnabled: true,
    });

    expect(triggerRunTask).toHaveBeenCalledWith({
      prompt: 'Use the computer',
      demo: false,
      options: {
        quickModeEnabled: true,
        computerUseEnabled: true,
        agentCount: 1,
      },
    });
    expect(streaming.startStreaming).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-computer',
        computerUseEnabled: true,
      })
    );
    cleanup();
  });

  it('persists model metadata when queuing prompts offline', async () => {
    const conversation = createConversationMock();
    const streaming = createStreamingMock();
    const triggerRunTask = jest.fn<RunTaskMutation>();

    const { hook, cleanup } = renderUseMessageSender({
      conversation,
      streaming,
      isOnline: false,
      triggerRunTask,
    });

    await hook.handleSendMessage('Offline model', { modelId: 'anthropic/claude-fable-5' });

    expect(enqueuePromptMock).toHaveBeenCalledWith(
      'conv-1',
      'Offline model',
      {
        prompt: 'Offline model',
        demo: false,
        modelId: 'anthropic/claude-fable-5',
        options: {
          quickModeEnabled: true,
          agentCount: 1,
        },
      }
    );
    cleanup();
  });

  it('queues attachment IDs for retry on transient server failures', async () => {
    const conversation = createConversationMock();
    const streaming = createStreamingMock();
    const error = new ApiClientError(503, { error: 'temporarily unavailable' }, 'unavailable');
    const triggerRunTask = jest.fn<RunTaskMutation>().mockRejectedValue(error);
    const attachmentIds = ['att-101', 'att-102'];

    const { hook, cleanup } = renderUseMessageSender({
      conversation,
      streaming,
      isOnline: true,
      triggerRunTask,
    });

    await hook.handleSendMessage('Analyze docs', undefined, attachmentIds);

    expect(enqueuePromptMock).toHaveBeenCalledWith(
      'conv-1',
      'Analyze docs',
      {
        prompt: 'Analyze docs',
        demo: false,
        attachment_ids: attachmentIds,
        options: {
          quickModeEnabled: true,
          agentCount: 1,
        },
      }
    );
    expect(streaming.setErrorMessage).toHaveBeenCalledWith(
      'The service is temporarily unavailable. Your prompt is saved and will retry automatically.'
    );
    cleanup();
  });

  it('sends both image and non-image attachments using their IDs', async () => {
    const conversation = createConversationMock();
    const streaming = createStreamingMock();
    const triggerRunTask = jest.fn<RunTaskMutation>().mockResolvedValue({ task_id: 'task-files' });

    const attachmentIds = ['att-1', 'att-2'];

    const { hook, cleanup } = renderUseMessageSender({
      conversation,
      streaming,
      isOnline: true,
      triggerRunTask,
    });

    await hook.handleSendMessage('Mixed files', undefined, attachmentIds);

    expect(triggerRunTask).toHaveBeenCalledWith({
      prompt: 'Mixed files',
      demo: false,
      attachment_ids: attachmentIds,
      options: {
        quickModeEnabled: true,
        agentCount: 1,
      },
    });
    cleanup();
  });

  it('uses a fallback prompt for attachment-only sends', async () => {
    const conversation = createConversationMock();
    const streaming = createStreamingMock();
    const triggerRunTask = jest.fn<RunTaskMutation>().mockResolvedValue({ task_id: 'task-attachments-only' });
    const attachmentIds = ['att-1'];

    const { hook, cleanup } = renderUseMessageSender({
      conversation,
      streaming,
      isOnline: true,
      triggerRunTask,
    });

    await hook.handleSendMessage('   ', undefined, attachmentIds);

    expect(conversation.onSendMessage).toHaveBeenCalledWith('[Attached 1 file]');
    expect(triggerRunTask).toHaveBeenCalledWith({
      prompt: 'Please analyze the attached file(s).',
      demo: false,
      attachment_ids: attachmentIds,
      options: {
        quickModeEnabled: true,
        agentCount: 1,
      },
    });
    const streamMetadata = streaming.startStreaming.mock.calls[0]?.[0];
    expect(streamMetadata).toEqual(
      expect.objectContaining({
        taskId: 'task-attachments-only',
        conversationId: 'conv-1',
        prompt: 'Please analyze the attached file(s).',
        agentCount: 1,
      })
    );
    expect(streamMetadata).not.toHaveProperty('computerUseEnabled');
    expect(streamMetadata).not.toHaveProperty('budgetLimit');
    cleanup();
  });

  // Regression test for TF-0956: ensureActiveConversation called only once per send,
  // even when triggerRunTask throws. Previously activeConversationId was declared inside
  // the try block, so the catch handler would call ensureActiveConversation a second time
  // (and might target a different conversation if the first call raced with a navigation).
  it('reuses the conversation id captured before the error without calling ensureActiveConversation again', async () => {
    const conversation = createConversationMock();
    const streaming = createStreamingMock();
    const triggerRunTask = jest.fn<RunTaskMutation>().mockRejectedValue(new Error('server exploded'));

    const { hook, cleanup } = renderUseMessageSender({
      conversation,
      streaming,
      isOnline: true,
      triggerRunTask,
    });

    await hook.handleSendMessage('hello');

    // ensureActiveConversation should be called exactly once (in the happy-path try block).
    // The catch branch must reuse activeConversationId and not call it again.
    expect(conversation.ensureActiveConversation).toHaveBeenCalledTimes(1);

    // The error message should still be set (generic failure path).
    expect(streaming.setErrorMessage).toHaveBeenCalled();

    cleanup();
  });
});
