import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../tests/setup/dom';

const handleLocalMcpCommandMock = vi.fn();
const fulfillPendingMcpApprovalMock = vi.fn();
const useWebMcpToolCatalogMock = vi.fn();
const usePlatformRuntimeMock = vi.fn();
const useConversationStoreMock = vi.fn();

vi.mock('../lib/mcp/local-command', () => ({
  handleLocalMcpCommand: handleLocalMcpCommandMock,
}));

vi.mock('../lib/mcp/approval', () => ({
  fulfillPendingMcpApproval: fulfillPendingMcpApprovalMock,
}));

vi.mock('../lib/mcp/useMcpToolCatalog', () => ({
  useWebMcpToolCatalog: useWebMcpToolCatalogMock,
}));

vi.mock('../lib/platform/PlatformProvider', () => ({
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
    expect(result.current.promptFormProps.ensureConversationId).toBe(
      session.conversation.ensureConversationId
    );

    result.current.promptFormProps.onSendMessage('Run this');
    result.current.promptFormProps.onConversationId(99);

    expect(session.conversation.onSendMessage).toHaveBeenCalledWith('Run this');
    expect(updateToRemoteConversation).toHaveBeenCalledWith(99);
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
      ensureConversationId: session.conversation.ensureConversationId,
      setMessages: session.conversation.setMessages,
      conversationStore,
    });
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
