import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, mock, vi } from 'bun:test';

import '../../../../../tests/setup/dom';

import type { ConversationSummary } from '@taskforceai/contracts/contracts';

import { useConversationState } from './useConversationState';

function createDeferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => {};
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

// Define mocks
const mockConversationStore = {
  getConversation: vi.fn(),
  getConversationMessages: vi.fn(),
  ensureConversation: vi.fn(),
  upsertMessage: vi.fn(),
  ingestRemoteConversationSummary: vi.fn(),
};

// Mock dependencies
mock.module('../platform/PlatformProvider', () => ({
  useConversationStore: vi.fn(() => mockConversationStore),
}));

const mockAuth: {
  isAuthenticated: boolean;
  sessionStatus: string;
  user: { id: string } | null;
} = {
  isAuthenticated: false,
  sessionStatus: 'unauthenticated',
  user: null,
};

mock.module('../providers/AuthProvider', () => ({
  useAuth: vi.fn(() => mockAuth),
}));

mock.module('../logger', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

mock.module('@taskforceai/web/lib/search', () => ({
  localSearch: {
    addItem: vi.fn(),
  },
}));

describe('useConversationState', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset auth state
    mockAuth.isAuthenticated = false;
    mockAuth.sessionStatus = 'unauthenticated';
    mockAuth.user = null;

    // Default store behavior
    mockConversationStore.getConversation.mockResolvedValue({
      ok: false,
      error: { kind: 'not_found', message: 'Conversation not found' },
    });
    mockConversationStore.getConversationMessages.mockResolvedValue([]);
    mockConversationStore.ensureConversation.mockResolvedValue(undefined);
    mockConversationStore.upsertMessage.mockResolvedValue(undefined);

    // Clear localStorage
    global.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not hydrate conversations on mount if unauthenticated', async () => {
    const { result } = renderHook(() => useConversationState());

    // It should eventually be initialized
    await waitFor(() => {
      expect(result.current.isInitialized).toBe(true);
    });

    // But it should NOT have attempted to load conversations
    expect(mockConversationStore.getConversation).not.toHaveBeenCalled();
  });

  it('creates a new conversation when starting a fresh chat', async () => {
    const { result } = renderHook(() => useConversationState());

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    act(() => {
      result.current.handleNewChat();
    });

    await waitFor(() => {
      expect(result.current.conversationId).toBeTruthy();
      expect(mockConversationStore.ensureConversation).toHaveBeenCalled();
      expect(global.localStorage.getItem('activeConversationId')).toBe(
        result.current.conversationId
      );
    });
  });

  it('adds user messages and persists them locally', async () => {
    mockAuth.isAuthenticated = true;
    mockAuth.sessionStatus = 'authenticated';

    const { result } = renderHook(() => useConversationState());

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    await act(async () => {
      await result.current.addUserMessage('Hello world');
    });

    expect(result.current.messages).toHaveLength(1);
    const [message] = result.current.messages;
    if (message) {
      expect(message.content).toBe('Hello world');
    }
    expect(mockConversationStore.upsertMessage).toHaveBeenCalled();
  });

  it('loads remote conversations and maps role metadata', async () => {
    mockAuth.isAuthenticated = true;
    mockAuth.sessionStatus = 'authenticated';

    const mockMessages = [
      { messageId: 'm1', content: 'Hi', role: 'user' },
      { messageId: 'm2', content: 'Hello', role: 'assistant' },
    ];
    mockConversationStore.getConversationMessages.mockResolvedValue(mockMessages);

    const { result } = renderHook(() => useConversationState());
    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    const remoteConv: ConversationSummary = {
      id: 123,
      timestamp: new Date().toISOString(),
      user_input: 'Remote prompt',
      result: 'Remote result',
      model: 'gpt-4',
    };

    await act(async () => {
      await result.current.loadConversation(remoteConv);
    });

    expect(result.current.conversationId).toBe('remote-123');
    expect(result.current.messages).toHaveLength(2);
    const [first, second] = result.current.messages;
    if (first && second) {
      expect(first.role).toBe('user');
      expect(second.role).toBe('assistant');
    }
  });

  it('handles restoration from localStorage on mount', async () => {
    mockAuth.isAuthenticated = true;
    mockAuth.sessionStatus = 'authenticated';

    const savedId = 'local-123';
    global.localStorage.setItem('activeConversationId', savedId);

    mockConversationStore.getConversation.mockResolvedValue({
      ok: true,
      value: { conversationId: savedId },
    });
    mockConversationStore.getConversationMessages.mockResolvedValue([
      { messageId: 'm1', content: 'Restored', role: 'user' },
    ]);

    const { result } = renderHook(() => useConversationState());

    await waitFor(() => {
      expect(result.current.isInitialized).toBe(true);
    });

    expect(result.current.conversationId).toBe(savedId);
    expect(result.current.messages).toHaveLength(1);
  });

  it('does not hydrate while session status is loading even when a cached user exists', async () => {
    mockAuth.isAuthenticated = false;
    mockAuth.sessionStatus = 'loading';
    mockAuth.user = { id: 'cached-user' };

    const savedId = 'local-loading-user';
    global.localStorage.setItem('activeConversationId', savedId);

    mockConversationStore.getConversation.mockResolvedValue({
      ok: true,
      value: { conversationId: savedId },
    });

    const { result } = renderHook(() => useConversationState());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.isInitialized).toBe(false);
    expect(mockConversationStore.getConversation).not.toHaveBeenCalled();
    expect(result.current.conversationId).toBeNull();
    expect(result.current.messages).toHaveLength(0);
  });

  it('runs restore once while initialization is in-flight across rerenders', async () => {
    mockAuth.isAuthenticated = true;
    mockAuth.sessionStatus = 'authenticated';
    mockAuth.user = null;

    const savedId = 'local-restore-once';
    global.localStorage.setItem('activeConversationId', savedId);

    const deferredConversation = createDeferred<{
      ok: true;
      value: { conversationId: string };
    }>();

    mockConversationStore.getConversation.mockImplementation(() => deferredConversation.promise);
    mockConversationStore.getConversationMessages.mockResolvedValue([
      { messageId: 'm1', content: 'Restored once', role: 'assistant' },
    ]);

    const { rerender, result } = renderHook(() => useConversationState());

    await waitFor(() => {
      expect(mockConversationStore.getConversation).toHaveBeenCalledTimes(1);
    });

    act(() => {
      mockAuth.user = { id: 'user-1' };
      rerender();
    });

    act(() => {
      mockAuth.user = { id: 'user-2' };
      rerender();
    });

    expect(mockConversationStore.getConversation).toHaveBeenCalledTimes(1);

    deferredConversation.resolve({
      ok: true,
      value: { conversationId: savedId },
    });

    await waitFor(() => {
      expect(result.current.isInitialized).toBe(true);
    });

    expect(result.current.conversationId).toBe(savedId);
    expect(result.current.messages).toHaveLength(1);
  });

  it('clears state when unauthenticated', async () => {
    mockAuth.isAuthenticated = true;
    mockAuth.sessionStatus = 'authenticated';

    const { result, rerender } = renderHook(() => useConversationState());

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    // Simulate active conversation
    act(() => {
      result.current.handleNewChat();
    });

    expect(result.current.conversationId).toBeTruthy();

    // Log out
    mockAuth.isAuthenticated = false;
    mockAuth.sessionStatus = 'unauthenticated';
    rerender();

    expect(result.current.conversationId).toBeNull();
    expect(result.current.messages).toEqual([]);
    expect(global.localStorage.getItem('activeConversationId')).toBeNull();
  });
});
