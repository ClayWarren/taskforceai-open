import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../tests/setup/dom';

const handleLocalMcpCommandMock = vi.fn();
const fulfillPendingMcpApprovalMock = vi.fn();
const useWebMcpToolCatalogMock = vi.fn();
const usePlatformRuntimeMock = vi.fn();
const useConversationStoreMock = vi.fn();

vi.mock('../../lib/mcp/local-command', () => ({
  handleLocalMcpCommand: handleLocalMcpCommandMock,
}));

vi.mock('../../lib/mcp/approval', () => ({
  fulfillPendingMcpApproval: fulfillPendingMcpApprovalMock,
}));

vi.mock('../../lib/mcp/useMcpToolCatalog', () => ({
  useWebMcpToolCatalog: useWebMcpToolCatalogMock,
}));

vi.mock('../../lib/platform/PlatformProvider', () => ({
  usePlatformRuntime: usePlatformRuntimeMock,
  useConversationStore: useConversationStoreMock,
}));

import { usePromptFormBridge } from './usePromptFormBridge';

const makeSession = () => ({
  conversation: {
    ensureConversationId: vi.fn(async () => 'conversation-42'),
    onSendMessage: vi.fn(async (_content: string) => undefined),
    setMessages: vi.fn(),
  },
  streaming: {
    clearErrorMessage: vi.fn(),
  },
});

describe('usePromptFormBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePlatformRuntimeMock.mockReturnValue('desktop');
    useConversationStoreMock.mockReturnValue({ kind: 'conversation-store' });
    useWebMcpToolCatalogMock.mockReturnValue({
      manager: { kind: 'mcp-manager' },
      snapshot: {
        toolSummary: '2 tools',
        items: [{ name: 'filesystem' }],
      },
    });
    handleLocalMcpCommandMock.mockResolvedValue({ handled: true });
    fulfillPendingMcpApprovalMock.mockResolvedValue(undefined);
  });

  it('builds prompt props from session, runtime, and MCP catalog', () => {
    const session = makeSession();
    const updateToRemoteConversation = vi.fn();

    const { result } = renderHook(() =>
      usePromptFormBridge({
        session: session as any,
        initialModelSelector: { models: [] } as any,
        isDisabled: true,
        updateToRemoteConversation,
        variant: 'bottom',
      })
    );

    expect(result.current.mcpToolCatalog.toolSummary).toBe('2 tools');
    expect(result.current.promptFormProps.variant).toBe('bottom');
    expect(result.current.promptFormProps.isDisabled).toBe(true);
    expect(result.current.promptFormProps.privateChat).toBe(false);
    expect(result.current.promptFormProps.ensureConversationId).toBe(
      session.conversation.ensureConversationId
    );

    result.current.promptFormProps.onSendMessage('Run this');
    result.current.promptFormProps.onConversationId(99);

    expect(session.conversation.onSendMessage).toHaveBeenCalledWith('Run this');
    expect(updateToRemoteConversation).toHaveBeenCalledWith(99);
  });

  it('forwards private chat mode to prompt form props', () => {
    const { result } = renderHook(() =>
      usePromptFormBridge({
        session: makeSession() as any,
        initialModelSelector: null,
        isDisabled: false,
        isPrivateChat: true,
        updateToRemoteConversation: vi.fn(),
        variant: 'bottom',
      })
    );

    expect(result.current.promptFormProps.privateChat).toBe(true);
  });

  it('mirrors realtime voice transcripts into local chat messages', async () => {
    const setMessages = vi.fn((updater) => {
      const previous = [
        {
          id: 'existing',
          role: 'assistant',
          content: 'Existing message',
        },
      ];
      return typeof updater === 'function' ? updater(previous) : updater;
    });
    const session = {
      ...makeSession(),
      conversation: {
        ...makeSession().conversation,
        ensureConversationId: vi.fn(async () => 'conversation-42'),
        setMessages,
      },
    };
    const conversationStore = { upsertMessage: vi.fn(async () => undefined) };
    useConversationStoreMock.mockReturnValue(conversationStore);

    const { result } = renderHook(() =>
      usePromptFormBridge({
        session: session as any,
        initialModelSelector: null,
        isDisabled: false,
        updateToRemoteConversation: vi.fn(),
        variant: 'bottom',
      })
    );

    result.current.promptFormProps.onRealtimeTranscriptMessagesChange([
      {
        id: 'user-active-speech',
        role: 'user',
        text: 'Listening...',
        isStreaming: true,
        isEphemeral: true,
      },
      {
        id: 'assistant-a1',
        role: 'assistant',
        text: 'Hello',
        isStreaming: false,
      },
    ]);

    const nextMessages = setMessages.mock.results[0]?.value;
    expect(nextMessages).toEqual([
      { id: 'existing', role: 'assistant', content: 'Existing message' },
      expect.objectContaining({
        id: 'realtime-voice-assistant-a1',
        role: 'assistant',
        content: 'Hello',
        isStreaming: false,
      }),
    ]);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(conversationStore.upsertMessage).toHaveBeenCalledTimes(1);
    expect(conversationStore.upsertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conversation-42',
        messageId: 'realtime-voice-assistant-a1',
        role: 'assistant',
        content: 'Hello',
        isStreaming: false,
      })
    );
  });

  it('keeps empty or ephemeral-only realtime transcript updates as a chat no-op when nothing is active', () => {
    const previousMessages = [
      {
        id: 'existing',
        role: 'assistant',
        content: 'Existing message',
      },
    ];
    const setMessages = vi.fn((updater) =>
      typeof updater === 'function' ? updater(previousMessages) : updater
    );
    const session = {
      ...makeSession(),
      conversation: {
        ...makeSession().conversation,
        setMessages,
      },
    };

    const { result } = renderHook(() =>
      usePromptFormBridge({
        session: session as any,
        initialModelSelector: null,
        isDisabled: false,
        updateToRemoteConversation: vi.fn(),
        variant: 'bottom',
      })
    );

    result.current.promptFormProps.onRealtimeTranscriptMessagesChange([]);

    expect(setMessages.mock.results[0]?.value).toBe(previousMessages);

    result.current.promptFormProps.onRealtimeTranscriptMessagesChange([
      {
        id: 'user-active-speech',
        role: 'user',
        text: 'Transcribing...',
        isStreaming: true,
        isEphemeral: true,
      },
    ]);

    expect(setMessages.mock.results[1]?.value).toBe(previousMessages);
  });

  it('forwards local MCP commands with conversation dependencies', async () => {
    const session = makeSession();
    const conversationStore = { kind: 'conversation-store' };
    const runtime = 'desktop';
    const manager = { kind: 'mcp-manager' };
    useConversationStoreMock.mockReturnValue(conversationStore);
    usePlatformRuntimeMock.mockReturnValue(runtime);
    useWebMcpToolCatalogMock.mockReturnValue({
      manager,
      snapshot: { toolSummary: '', items: [] },
    });

    const { result } = renderHook(() =>
      usePromptFormBridge({
        session: session as any,
        initialModelSelector: null,
        isDisabled: false,
        updateToRemoteConversation: vi.fn(),
        variant: 'centered',
      })
    );

    const handled = await result.current.promptFormProps.onLocalCommand({
      prompt: '/mcp list',
      attachmentIds: ['file-1'],
      computerUseEnabled: true,
      computerUseTarget: 'local',
    });

    expect(handled).toBe(true);
    expect(handleLocalMcpCommandMock).toHaveBeenCalledWith({
      prompt: '/mcp list',
      attachmentIds: ['file-1'],
      computerUseEnabled: true,
      computerUseTarget: 'local',
      runtime,
      manager,
      persistMessages: true,
      ensureConversationId: session.conversation.ensureConversationId,
      setMessages: session.conversation.setMessages,
      conversationStore,
    });
  });

  it('skips durable transcript writes when persistence is disabled', async () => {
    const setMessages = vi.fn((updater) => (typeof updater === 'function' ? updater([]) : updater));
    const session = {
      ...makeSession(),
      conversation: {
        ...makeSession().conversation,
        ensureConversationId: vi.fn(async () => 'private-1'),
        setMessages,
      },
    };
    const conversationStore = { upsertMessage: vi.fn(async () => undefined) };
    useConversationStoreMock.mockReturnValue(conversationStore);

    const { result } = renderHook(() =>
      usePromptFormBridge({
        session: session as any,
        initialModelSelector: null,
        isDisabled: false,
        persistenceEnabled: false,
        updateToRemoteConversation: vi.fn(),
        variant: 'bottom',
      })
    );

    result.current.promptFormProps.onRealtimeTranscriptMessagesChange([
      {
        id: 'assistant-a1',
        role: 'assistant',
        text: 'Private answer',
        isStreaming: false,
      },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(setMessages).toHaveBeenCalled();
    expect(conversationStore.upsertMessage).not.toHaveBeenCalled();
  });

  it('returns false when a local command is not handled', async () => {
    handleLocalMcpCommandMock.mockResolvedValueOnce({ handled: false });
    const session = makeSession();

    const { result } = renderHook(() =>
      usePromptFormBridge({
        session: session as any,
        initialModelSelector: null,
        isDisabled: false,
        updateToRemoteConversation: vi.fn(),
        variant: 'centered',
      })
    );

    await expect(
      result.current.promptFormProps.onLocalCommand({
        prompt: 'normal message',
      })
    ).resolves.toBe(false);
  });

  it('forwards MCP approvals to the active runtime manager', async () => {
    const session = makeSession();
    const approval = { approved: true };

    const { result } = renderHook(() =>
      usePromptFormBridge({
        session: session as any,
        initialModelSelector: null,
        isDisabled: false,
        updateToRemoteConversation: vi.fn(),
        variant: 'bottom',
      })
    );

    await result.current.promptFormProps.onMcpApproval('task-1', approval as any);

    expect(fulfillPendingMcpApprovalMock).toHaveBeenCalledWith({
      taskId: 'task-1',
      approval,
      runtime: 'desktop',
      manager: { kind: 'mcp-manager' },
    });
  });
});
