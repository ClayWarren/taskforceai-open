import { renderHook, act } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useConversationState } from '../../hooks/useConversationState';
import * as chatLocal from '../../storage/chat-local-mobile';
import * as idUtils from '@taskforceai/system-runtime/id';

jest.mock('../../storage/chat-local-mobile');
jest.mock('@taskforceai/system-runtime/id');

const mockChatLocal = chatLocal as jest.Mocked<typeof chatLocal>;
const mockIdUtils = idUtils as jest.Mocked<typeof idUtils>;

let idCounter = 0;

beforeEach(() => {
    jest.clearAllMocks();
    idCounter = 0;
    mockIdUtils.createId.mockImplementation((prefix) => `${prefix}-${++idCounter}`);
    mockChatLocal.upsertMessage.mockResolvedValue(undefined);
    mockChatLocal.mobileConversationStore.ensureConversation = jest.fn().mockResolvedValue(undefined) as any;
    mockChatLocal.mobileConversationStore.upsertMessage = jest.fn().mockResolvedValue(undefined) as any;
    mockChatLocal.mobileConversationStore.getConversation = jest.fn().mockImplementation(async (id) => ({
        ok: true,
        value: { conversationId: id, title: 'Test', createdAt: 100, updatedAt: 100, lastMessagePreview: null }
    })) as any;
    mockChatLocal.mobileConversationStore.getConversationMessages = jest.fn().mockResolvedValue([]) as any;
    mockChatLocal.getConversationMessages.mockResolvedValue({ ok: true, value: [] });
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
    (AsyncStorage.removeItem as jest.Mock).mockResolvedValue(undefined);
});

describe('useConversationState', () => {
    it('initializes with empty messages and null conversationId', async () => {
        const { result } = await renderHook(() => useConversationState());
        await act(async () => { await new Promise(r => setTimeout(r, 10)); });
        expect(result.current.messages).toEqual([]);
        expect(result.current.conversationId).toBeNull();
    });

    it('restores a conversation from AsyncStorage on mount', async () => {
        const savedId = 'saved-conv-1';
        (AsyncStorage.getItem as jest.Mock).mockResolvedValue(savedId);
        const messages = [
            { id: 1, conversationId: savedId, messageId: 'msg-1', role: 'user', content: 'Hello', isStreaming: 0, createdAt: 100, updatedAt: 100, agentStatuses: null, error: null, isAgentStatus: 0, elapsedSeconds: null, sources: null, toolEvents: null },
        ];
        mockChatLocal.getConversationMessages.mockResolvedValue({ ok: true, value: messages as any });
        mockChatLocal.mobileConversationStore.getConversationMessages = jest.fn().mockResolvedValue(messages) as any;

        const { result } = await renderHook(() => useConversationState());
        await act(async () => { await new Promise(r => setTimeout(r, 50)); });

        expect(result.current.conversationId).toBe(savedId);
        expect(result.current.messages).toHaveLength(1);
        expect(result.current.messages[0].content).toBe('Hello');
    });

    it('does not restore saved chat history while signed out', async () => {
        (AsyncStorage.getItem as jest.Mock).mockResolvedValue('saved-conv-1');

        const { result } = await renderHook(() =>
            useConversationState({
                isAuthenticated: false,
                sessionStatus: 'unauthenticated',
                user: null,
            })
        );
        await act(async () => { await new Promise(r => setTimeout(r, 50)); });

        expect(result.current.conversationId).toBeNull();
        expect(result.current.messages).toEqual([]);
        expect(AsyncStorage.getItem).not.toHaveBeenCalled();
        expect(mockChatLocal.mobileConversationStore.getConversationMessages).not.toHaveBeenCalled();
    });

    it('creates guest-owned conversation ids while signed out', async () => {
        const { result } = await renderHook(() =>
            useConversationState({
                isAuthenticated: false,
                sessionStatus: 'unauthenticated',
                user: null,
            })
        );
        await act(async () => { await new Promise(r => setTimeout(r, 10)); });

        let conversationId = '';
        await act(async () => {
            conversationId = await result.current.ensureActiveConversation();
        });

        expect(conversationId).toMatch(/^guest-/);
        expect(AsyncStorage.setItem).toHaveBeenCalledWith(
            '@taskforceai:activeConversationId:guest',
            conversationId
        );
    });

    it('clears saved conversation if no conversation found in store', async () => {
        (AsyncStorage.getItem as jest.Mock).mockResolvedValue('stale-conv');
        mockChatLocal.mobileConversationStore.getConversation = jest.fn().mockResolvedValue({ ok: false, error: { kind: 'not_found', message: 'Not found' } }) as any;

        const { result } = await renderHook(() => useConversationState());
        await act(async () => { await new Promise(r => setTimeout(r, 50)); });

        expect(result.current.conversationId).toBeNull();
        expect(AsyncStorage.removeItem).toHaveBeenCalledWith('@taskforceai:activeConversationId');
    });

    it('ensureActiveConversation creates a new conversation', async () => {
        const { result } = await renderHook(() => useConversationState());
        await act(async () => { await new Promise(r => setTimeout(r, 10)); });

        let convId: string = '';
        await act(async () => {
            convId = await result.current.ensureActiveConversation();
        });

        expect(convId).toMatch(/^local-/);
        expect(mockChatLocal.mobileConversationStore.ensureConversation).toHaveBeenCalledWith(convId, 'New Conversation');
        expect(AsyncStorage.setItem).toHaveBeenCalledWith('@taskforceai:activeConversationId', convId);
    });

    it('ensureActiveConversation returns existing id if present', async () => {
        const { result } = await renderHook(() => useConversationState());
        await act(async () => { await new Promise(r => setTimeout(r, 10)); });

        let id1 = '';
        let id2 = '';
        await act(async () => { id1 = await result.current.ensureActiveConversation(); });
        await act(async () => { id2 = await result.current.ensureActiveConversation(); });
        expect(id1).toBe(id2);
    });

    it('addUserMessage adds a message and persists it', async () => {
        const { result } = await renderHook(() => useConversationState());
        await act(async () => { await new Promise(r => setTimeout(r, 10)); });

        await act(async () => {
            await result.current.addUserMessage('Test content');
        });

        expect(result.current.messages).toHaveLength(1);
        expect(result.current.messages[0].content).toBe('Test content');
        expect(result.current.messages[0].role).toBe('user');
        expect(mockChatLocal.mobileConversationStore.upsertMessage).toHaveBeenCalledWith(
            expect.objectContaining({ role: 'user', content: 'Test content' })
        );
    });

    it('handleNewChat resets messages and creates new conversation', async () => {
        const { result } = await renderHook(() => useConversationState());
        await act(async () => { await new Promise(r => setTimeout(r, 10)); });

        await act(async () => { await result.current.addUserMessage('Old message'); });
        expect(result.current.messages).toHaveLength(1);

        await act(async () => { await result.current.handleNewChat(); });
        expect(result.current.messages).toEqual([]);
        expect(result.current.conversationId).toBeTruthy();
        expect(mockChatLocal.mobileConversationStore.ensureConversation).toHaveBeenCalled();
    });

    it('loadConversation sets messages from storage', async () => {
        const messages = [
            { id: 1, conversationId: 'remote-5', messageId: 'msg-5', role: 'assistant', content: 'Hi', isStreaming: 0, createdAt: 200, updatedAt: 200, agentStatuses: null, error: null, isAgentStatus: 0, elapsedSeconds: null, sources: null, toolEvents: null },
        ];
        mockChatLocal.getConversationMessages.mockResolvedValue({ ok: true, value: messages as any });
        mockChatLocal.mobileConversationStore.getConversationMessages = jest.fn().mockResolvedValue(messages) as any;

        const { result } = await renderHook(() => useConversationState());
        await act(async () => { await new Promise(r => setTimeout(r, 10)); });

        await act(async () => {
            await result.current.loadConversation({ id: 5, title: 'Test', model: 'gpt-4', createdAt: '' } as any);
        });

        expect(result.current.conversationId).toBe('remote-5');
        expect(result.current.messages).toHaveLength(1);
        expect(result.current.messages[0].content).toBe('Hi');
    });

    it('loadConversation uses model for negative ids', async () => {
        mockChatLocal.getConversationMessages.mockResolvedValue({ ok: true, value: [] });

        const { result } = await renderHook(() => useConversationState());
        await act(async () => { await new Promise(r => setTimeout(r, 10)); });

        await act(async () => {
            await result.current.loadConversation({ id: -3, title: 'Test', model: 'gpt-4', createdAt: '' } as any);
        });

        expect(result.current.conversationId).toBe('gpt-4');
    });
});
