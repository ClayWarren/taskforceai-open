import { renderHook, act } from '@testing-library/react-native';

import { queryKeys } from '../../hooks/api/queryKeys';
import { useChatCoordinator } from '../../hooks/useChatCoordinator';

const mockPush = jest.fn();
const mockInvalidateQueries = jest.fn(async () => undefined);
const mockTriggerRunTask = jest.fn(async () => ({ task_id: 'task-1' }));
const mockResetStreamingState = jest.fn();
const mockHandleSendMessage = jest.fn(async () => undefined);
const mockUsePendingPromptQueue = jest.fn();
const mockHandleClearCache = jest.fn(async () => undefined);
const mockUpsertMessage = jest.fn(async () => undefined);
const mockDeleteMessage = jest.fn(async () => undefined);
const mockMcpManager = {} as any;
const mockMcpToolCatalog = {
  toolSummary: { totalCount: 0, enabledCount: 0, disabledCount: 0 },
  items: [],
};
const mockRequestAiDataSharingConsent = jest.fn(async () => true);

let mockIsAuthenticated = true;
let mockIsOnline = true;

const mockConversationState = {
  messages: [] as Array<{ id: string; role: string; content: string }>,
  conversationId: 'conv-1' as string | null,
  ensureActiveConversation: jest.fn(async () => 'conv-1'),
  setMessages: jest.fn(),
  addUserMessage: jest.fn(async () => undefined),
  handleNewChat: jest.fn(async () => undefined),
  loadConversation: jest.fn(async () => undefined),
};

const mockStreamingStore = {
  isStreaming: false,
  streamContent: '',
  agentStatuses: [],
  elapsedSeconds: 0,
  sources: [],
  finalSources: [],
  toolEvents: [],
  finalToolEvents: [],
  finalResponse: null,
  errorMessage: null as string | null,
  computerUseEnabled: true,
  modelLabel: 'openai/gpt-5.5',
  startStreaming: jest.fn(async () => undefined),
  clearErrorMessage: jest.fn(),
  setErrorMessage: jest.fn(),
};

let capturedMessageSenderOptions: any;

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
  }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: mockIsAuthenticated }),
}));

jest.mock('../../contexts/SyncContext', () => ({
  useSync: () => ({ isOnline: mockIsOnline }),
}));

jest.mock('../../hooks/useConversationState', () => ({
  useConversationState: () => mockConversationState,
}));

jest.mock('../../streaming/useStreamingStore', () => ({
  useStreamingStore: () => mockStreamingStore,
}));

jest.mock('../../hooks/api/runTask', () => ({
  useRunTaskMutation: () => ({ mutateAsync: mockTriggerRunTask }),
}));

jest.mock('../../hooks/useCacheMaintenance', () => ({
  useCacheMaintenance: () => ({ handleClearCache: mockHandleClearCache }),
}));

jest.mock('../../hooks/useStreamingMessages', () => ({
  useStreamingMessages: jest.fn(() => ({ resetStreamingState: mockResetStreamingState })),
}));

jest.mock('../../hooks/useMessageSender', () => ({
  useMessageSender: jest.fn((options) => {
    capturedMessageSenderOptions = options;
    return { handleSendMessage: mockHandleSendMessage };
  }),
}));

jest.mock('../../hooks/usePendingPromptQueue', () => ({
  usePendingPromptQueue: (...args: unknown[]) => mockUsePendingPromptQueue(...args),
}));

jest.mock('../../mcp/useMcpToolCatalog', () => ({
  useMobileMcpToolCatalog: () => ({
    manager: mockMcpManager,
    snapshot: mockMcpToolCatalog,
  }),
}));

jest.mock('../../privacy/aiDataConsent', () => ({
  requestAiDataSharingConsent: () => mockRequestAiDataSharingConsent(),
}));

jest.mock('../../storage/chat-local-mobile', () => ({
  upsertMessage: (...args: unknown[]) => mockUpsertMessage(...args),
  deleteMessage: (...args: unknown[]) => mockDeleteMessage(...args),
}));

describe('useChatCoordinator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAuthenticated = true;
    mockIsOnline = true;
    mockConversationState.messages = [];
    mockConversationState.conversationId = 'conv-1';
    mockStreamingStore.isStreaming = false;
    mockStreamingStore.streamContent = '';
    mockStreamingStore.finalResponse = null;
    mockStreamingStore.errorMessage = null;
    mockRequestAiDataSharingConsent.mockResolvedValue(true);
    capturedMessageSenderOptions = undefined;
  });

  it('opens and closes sidebar via handlers', () => {
    const { result } = renderHook(() => useChatCoordinator());

    expect(result.current.isSidebarVisible).toBe(false);

    act(() => {
      result.current.handleOpenSidebar();
    });
    expect(result.current.isSidebarVisible).toBe(true);

    act(() => {
      result.current.handleCloseSidebar();
    });
    expect(result.current.isSidebarVisible).toBe(false);
  });

  it('navigates to login route when handleLogin is called', () => {
    const { result } = renderHook(() => useChatCoordinator());

    act(() => {
      result.current.handleLogin();
    });

    expect(mockPush).toHaveBeenCalledWith('/login');
  });

  it('resets stream state, starts a new chat, clears errors, and closes sidebar', async () => {
    const { result } = renderHook(() => useChatCoordinator());

    act(() => {
      result.current.handleOpenSidebar();
    });
    expect(result.current.isSidebarVisible).toBe(true);

    await act(async () => {
      await result.current.handleNewChat();
    });

    expect(mockResetStreamingState).toHaveBeenCalledTimes(1);
    expect(mockConversationState.handleNewChat).toHaveBeenCalledTimes(1);
    expect(mockStreamingStore.clearErrorMessage).toHaveBeenCalledTimes(1);
    expect(result.current.isSidebarVisible).toBe(false);
  });

  it('loads selected conversation and closes sidebar', async () => {
    const summary = { id: 42, model: 'remote-42' } as any;
    const { result } = renderHook(() => useChatCoordinator());

    act(() => {
      result.current.handleOpenSidebar();
    });
    expect(result.current.isSidebarVisible).toBe(true);

    await act(async () => {
      await result.current.handleConversationSelect(summary);
    });

    expect(mockConversationState.loadConversation).toHaveBeenCalledWith(summary);
    expect(result.current.isSidebarVisible).toBe(false);
  });

  it('passes pending prompt invalidation callback into message sender', async () => {
    renderHook(() => useChatCoordinator());

    await act(async () => {
      await capturedMessageSenderOptions.invalidatePendingPrompts();
    });

    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.pendingPrompts,
    });
  });

  it('passes narrow runtime adapters into the message sender', () => {
    renderHook(() => useChatCoordinator());

    expect(capturedMessageSenderOptions.conversation).toEqual(
      expect.objectContaining({
        onSendMessage: mockConversationState.addUserMessage,
        ensureActiveConversation: mockConversationState.ensureActiveConversation,
        ensureConversationId: mockConversationState.ensureActiveConversation,
        setMessages: mockConversationState.setMessages,
      })
    );
    expect(capturedMessageSenderOptions.streaming).toEqual({
      startStreaming: mockStreamingStore.startStreaming,
      clearErrorMessage: mockStreamingStore.clearErrorMessage,
      setErrorMessage: mockStreamingStore.setErrorMessage,
    });
  });

  it('registers pending prompt queue with streaming and connectivity state', () => {
    mockStreamingStore.isStreaming = true;
    mockIsOnline = false;

    renderHook(() => useChatCoordinator());

    expect(mockUsePendingPromptQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        isOnline: false,
        isStreaming: true,
        startStreaming: mockStreamingStore.startStreaming,
        invalidatePendingPrompts: expect.any(Function),
      })
    );
  });

  it('returns key coordinator values from dependencies', () => {
    const { result } = renderHook(() => useChatCoordinator());

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.isOnline).toBe(true);
    expect(result.current.computerUseEnabled).toBe(true);
    expect(result.current.handleSendMessage).toEqual(expect.any(Function));
    expect(result.current.handleClearCache).toBe(mockHandleClearCache);
  });

  it('forwards sends to message sender when authenticated', async () => {
    const { result } = renderHook(() => useChatCoordinator());

    await act(async () => {
      await result.current.handleSendMessage('hello', { modelId: 'moonshotai/kimi-k2.6' });
    });

    expect(mockHandleSendMessage).toHaveBeenCalledWith('hello', {
      modelId: 'moonshotai/kimi-k2.6',
    });
    expect(mockRequestAiDataSharingConsent).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalledWith('/login');
  });

  it('requires AI data-sharing consent before invoking message sender', async () => {
    mockRequestAiDataSharingConsent.mockResolvedValueOnce(false);
    const { result } = renderHook(() => useChatCoordinator());

    await act(async () => {
      await result.current.handleSendMessage('hello');
    });

    expect(mockHandleSendMessage).not.toHaveBeenCalled();
    expect(mockStreamingStore.setErrorMessage).toHaveBeenCalledWith(
      'privacy.aiDataSharingRequired'
    );
    expect(mockPush).not.toHaveBeenCalledWith('/login');
  });

  it('routes unauthenticated sends to login after consent without invoking message sender', async () => {
    mockIsAuthenticated = false;
    const { result } = renderHook(() => useChatCoordinator());

    await act(async () => {
      await result.current.handleSendMessage('hello');
    });

    expect(mockRequestAiDataSharingConsent).toHaveBeenCalledTimes(1);
    expect(mockHandleSendMessage).not.toHaveBeenCalled();
    expect(mockStreamingStore.setErrorMessage).toHaveBeenCalledWith('auth.signInRequired');
    expect(mockPush).toHaveBeenCalledWith('/login');
  });
});
