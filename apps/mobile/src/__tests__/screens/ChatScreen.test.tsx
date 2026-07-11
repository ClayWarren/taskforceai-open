import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { Keyboard } from 'react-native';

import { ChatScreen } from '../../screens/ChatScreen';
import type { Message } from '../../types';

const mockScrollToOffset = jest.fn();
const mockRealtimeConnect = jest.fn();
const mockRealtimeDisconnect = jest.fn();
const mockRealtimePrewarm = jest.fn();
const mockRealtimeResetSession = jest.fn();
const keyboardDismissSpy = jest.spyOn(Keyboard, 'dismiss').mockImplementation(jest.fn());
let latestPromptInputProps: any = null;
let latestFlashListProps: any = null;
let mockRealtimeVoiceState: any = null;

jest.mock('@shopify/flash-list', () => {
  const react = require('react');
  const { View } = require('react-native');
  const toVisualItems = (items: any[], inverted: boolean) => {
    if (!inverted) {
      return items;
    }
    const ordered = [];
    for (let index = items.length - 1; index >= 0; index--) {
      ordered.push(items[index]);
    }
    return ordered;
  };
  return {
    __esModule: true,
    FlashList: react.forwardRef((props: any, ref: any) => {
      latestFlashListProps = props;
      react.useImperativeHandle(ref, () => ({
        scrollToOffset: mockScrollToOffset,
      }));
      const items = toVisualItems(props.data || [], Boolean(props.inverted));
      return react.createElement(
        View,
        null,
        props.ListHeaderComponent,
        items.map((item: any, index: number) => 
          react.createElement(View, { key: index }, props.renderItem({ item, index }))
        )
      );
    }),
  };
});

jest.mock('../../assets/logo-transparent.png', () => 1, { virtual: true });

const mockUseModelSelectorQuery = jest.fn(() => ({
  data: {
    defaultModelId: 'openai/gpt-5.6-sol',
    options: [],
  },
}));

jest.mock('../../hooks/api/modelSelector', () => ({
  __esModule: true,
  useModelSelectorQuery: (...args: unknown[]) => mockUseModelSelectorQuery(...args),
}));

jest.mock('../../components/MessageBubble', () => {
  const react = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    MessageBubble: ({ message, privateChat }: any) =>
      react.createElement(
        react.Fragment,
        null,
        react.createElement(Text, null, message.content),
        react.createElement(Text, null, `message-private:${String(privateChat)}`)
      ),
  };
});

jest.mock('../../components/PromptInput', () => {
  const react = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    PromptInput: (props: any) => {
      latestPromptInputProps = props;
      return react.createElement(Text, null, props.isDisabled ? 'prompt-disabled' : 'prompt-enabled');
    },
  };
});

jest.mock('../../components/RateLimitError', () => {
  const react = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    RateLimitError: ({ message }: any) => react.createElement(Text, null, `rate-limit:${message}`),
  };
});

jest.mock('../../components/RealtimeVoiceSessionPanel', () => {
  const react = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    RealtimeVoiceSessionPanel: (props: any) =>
      props.isActive || props.endedDurationMs !== null
        ? react.createElement(Text, null, 'voice-orb')
        : null,
  };
});

jest.mock('../../hooks/useRealtimeVoiceSession', () => ({
  __esModule: true,
  useRealtimeVoiceSession: () => mockRealtimeVoiceState,
}));

jest.mock('../../components/ComputerTheater', () => {
  const react = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    ComputerTheater: () => react.createElement(Text, null, 'computer-theater'),
  };
});

jest.mock('../../components/AutonomousPanel', () => ({
  __esModule: true,
  AutonomousPanel: () => null,
}));

jest.mock('../../components/OrchestrationModal', () => ({
  __esModule: true,
  OrchestrationModal: () => null,
}));

jest.mock('../../components/LocalErrorBoundary', () => ({
  __esModule: true,
  LocalErrorBoundary: ({ children }: any) => children,
}));

// Mock internal components that are used in DefaultStreamingFooter
// since they are not exported but are part of the ChatScreen.tsx file.
// We can't easily mock them if they are local to the file unless we 
// mock the whole file, which we don't want to do.
// Instead, we ensure the test environment can handle them or we 
// avoid triggering the code paths that use them if possible.
// Actually, the error is likely because they are NOT components but 
// are used AS components in the JSX.

const noop = jest.fn(async () => undefined);

const collectRenderedText = (node: unknown): string[] => {
  if (!node) {
    return [];
  }
  if (typeof node === 'string') {
    return [node];
  }
  if (Array.isArray(node)) {
    return node.flatMap(collectRenderedText);
  }
  if (typeof node === 'object' && 'children' in node) {
    return collectRenderedText((node as { children?: unknown }).children);
  }
  return [];
};

const baseProps = {
  messages: [] as Message[],
  isStreaming: false,
  streamContent: '',
  agentStatuses: [],
  elapsedSeconds: 0,
  sources: [],
  toolEvents: [],
  errorMessage: null as string | null,
  rateLimitResetTime: null as string | null,
  onClearError: jest.fn(),
  onSendMessage: noop,
  modelLabel: null as string | null,
};

describe('ChatScreen', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockUseModelSelectorQuery.mockClear();
    mockScrollToOffset.mockClear();
    mockRealtimeConnect.mockClear();
    mockRealtimeDisconnect.mockClear();
    mockRealtimePrewarm.mockClear();
    mockRealtimeResetSession.mockClear();
    keyboardDismissSpy.mockClear();
    latestPromptInputProps = null;
    latestFlashListProps = null;
    mockRealtimeVoiceState = {
      connect: mockRealtimeConnect,
      disconnect: mockRealtimeDisconnect,
      endedDurationMs: null,
      errorMessage: null,
      isActive: false,
      isCapturing: false,
      isPlaying: false,
      messages: [],
      prewarm: mockRealtimePrewarm,
      resetSession: mockRealtimeResetSession,
      status: 'disconnected',
    };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows empty-state logo when there are no messages', async () => {
    await render(<ChatScreen {...baseProps} />);
    expect(screen.getByLabelText('TaskForceAI logo')).toBeTruthy();
    expect(mockRealtimePrewarm).toHaveBeenCalledTimes(1);
  });

  it('keeps realtime voice setup warm while authenticated', async () => {
    await render(<ChatScreen {...baseProps} />);

    expect(mockRealtimePrewarm).toHaveBeenCalledTimes(1);

    await act(() => {
      jest.advanceTimersByTime(20_000);
    });

    expect(mockRealtimePrewarm).toHaveBeenCalledTimes(2);
  });

  it('loads public model data before authentication', async () => {
    await render(<ChatScreen {...baseProps} isAuthenticated={false} />);
    expect(mockUseModelSelectorQuery).toHaveBeenCalledWith();
    expect(mockRealtimePrewarm).not.toHaveBeenCalled();
  });

  it('renders rate limit banner for rate limit errors', async () => {
    const messages: Message[] = [{ id: 'msg-1', role: 'user', content: 'hello' }];
    await render(
      <ChatScreen
        {...baseProps}
        messages={messages}
        errorMessage="Rate limit exceeded"
      />
    );

    expect(screen.getByText('rate-limit:Rate limit exceeded')).toBeTruthy();
  });

  it('renders generic error text when error is not a rate limit error', async () => {
    const messages: Message[] = [{ id: 'msg-2', role: 'assistant', content: 'done' }];
    await render(
      <ChatScreen
        {...baseProps}
        messages={messages}
        errorMessage="Unexpected error"
      />
    );

    expect(screen.getByText('Unexpected error')).toBeTruthy();
  });

  it('shows computer theater when computer use is enabled', async () => {
    await render(<ChatScreen {...baseProps} computerUseEnabled={true} isStreaming={true} />);
    expect(screen.getByText('computer-theater')).toBeTruthy();
  });

  it('renders messages in the correct order: user → thinking → reply (Hardening TF-0222)', async () => {
    const messages: Message[] = [
      { id: 'user-msg', role: 'user', content: 'User Question' },
      { id: 'thinking-msg', role: 'assistant', content: 'Thinking...', isAgentStatus: true },
      { id: 'reply-msg', role: 'assistant', content: 'Agent Reply' },
    ];

    await render(<ChatScreen {...baseProps} messages={messages} />);

    // In our mock FlashList, we render items in order of data array.
    // We verify the sequence of content in the rendered tree.
    const messageTexts = screen.getAllByText(/User Question|Thinking...|Agent Reply/);
    expect(messageTexts).toHaveLength(3);
    expect(messageTexts[0]?.props.children).toBe('User Question');
    expect(messageTexts[1]?.props.children).toBe('Thinking...');
    expect(messageTexts[2]?.props.children).toBe('Agent Reply');
  });

  it('keeps private direct replies below their prompt when batched out of order', async () => {
    const messages: Message[] = [
      {
        id: 'assistant-direct',
        role: 'assistant',
        content: 'Private direct reply',
        createdAt: 2_000,
        updatedAt: 2_000,
      },
      {
        id: 'user-direct',
        role: 'user',
        content: 'Private direct prompt',
        createdAt: 1_000,
        updatedAt: 1_000,
      },
    ];

    await render(<ChatScreen {...baseProps} messages={messages} privateChat={true} />);

    const messageTexts = screen.getAllByText(/Private direct prompt|Private direct reply/);
    expect(messageTexts).toHaveLength(2);
    expect(messageTexts[0]?.props.children).toBe('Private direct prompt');
    expect(messageTexts[1]?.props.children).toBe('Private direct reply');
  });

  it('passes private chat state into rendered message rows', async () => {
    const messages: Message[] = [{ id: 'reply-private', role: 'assistant', content: 'Private reply' }];

    await render(<ChatScreen {...baseProps} messages={messages} privateChat={true} />);

    expect(screen.getByText('message-private:true')).toBeTruthy();
    expect(latestPromptInputProps.privateChat).toBe(true);
    expect(mockRealtimePrewarm).not.toHaveBeenCalled();
  });

  it('does not start realtime voice while private chat is active', async () => {
    await render(<ChatScreen {...baseProps} privateChat={true} />);

    await act(() => {
      latestPromptInputProps.onRealtimeVoice();
    });

    expect(mockRealtimeConnect).not.toHaveBeenCalled();
  });

  it('keeps the active agent progress near the composer while streaming', async () => {
    const messages: Message[] = [
      { id: 'user-msg', role: 'user', content: 'Run a team task' },
      { id: 'status-msg', role: 'assistant', content: '', isAgentStatus: true },
    ];

    await render(
      <ChatScreen
        {...baseProps}
        messages={messages}
        isStreaming={true}
        agentStatuses={[{ id: 'agent-1', label: 'agent-1', state: 'running', progress: 0.4 }]}
      />
    );

    await act(() => {
      jest.advanceTimersByTime(80);
    });

    expect(mockScrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: true });
  });

  it('scrolls a newly completed response into view after streaming ends', async () => {
    const initialMessages: Message[] = [
      { id: 'user-msg', role: 'user', content: 'Generate a video' },
    ];
    const completedMessages: Message[] = [
      ...initialMessages,
      { id: 'reply-msg', role: 'assistant', content: 'Generated video ready' },
    ];

    const { rerender } = await render(<ChatScreen {...baseProps} messages={initialMessages} />);

    await rerender(
      <ChatScreen
        {...baseProps}
        messages={completedMessages}
        isStreaming={false}
      />
    );

    await act(() => {
      jest.advanceTimersByTime(80);
    });

    expect(mockScrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: true });
  });

  it('controls prompt computer use mode from the chat screen', async () => {
    await render(<ChatScreen {...baseProps} />);

    expect(latestPromptInputProps.computerUseEnabled).toBe(false);

    await act(() => {
      latestPromptInputProps.onComputerUseToggle();
    });

    expect(latestPromptInputProps.computerUseEnabled).toBe(true);
  });

  it('starts realtime voice before host conversation bookkeeping', async () => {
    const callOrder: string[] = [];
    mockRealtimeConnect.mockImplementationOnce(() => {
      callOrder.push('connect');
      return Promise.resolve();
    });
    const onRealtimeVoiceStart = jest.fn(() => {
      callOrder.push('start');
      return Promise.resolve();
    });

    await render(<ChatScreen {...baseProps} onRealtimeVoiceStart={onRealtimeVoiceStart} />);

    await act(() => {
      latestPromptInputProps.onRealtimeVoice();
    });

    expect(callOrder).toEqual(['connect', 'start']);
    expect(onRealtimeVoiceStart).toHaveBeenCalledTimes(1);
  });

  it('gates older-message pagination on hasMoreMessages', async () => {
    const onLoadMoreMessages = jest.fn();
    const messages: Message[] = [{ id: 'msg-1', role: 'user', content: 'hello' }];

    const { rerender } = await render(
      <ChatScreen
        {...baseProps}
        messages={messages}
        hasMoreMessages={false}
        onLoadMoreMessages={onLoadMoreMessages}
      />
    );
    expect(latestFlashListProps.onEndReached).toBeUndefined();

    await rerender(
      <ChatScreen
        {...baseProps}
        messages={messages}
        hasMoreMessages={true}
        onLoadMoreMessages={onLoadMoreMessages}
      />
    );
    expect(latestFlashListProps.onEndReached).toBe(onLoadMoreMessages);
  });

  it('keeps realtime voice in the chat surface instead of showing the empty logo', async () => {
    mockRealtimeVoiceState = {
      ...mockRealtimeVoiceState,
      isActive: true,
      isCapturing: true,
      status: 'connected',
    };

    const { toJSON } = await render(<ChatScreen {...baseProps} />);

    expect(screen.queryByLabelText('TaskForceAI logo')).toBeNull();
    expect(screen.getByTestId('chat-message-region')).toBeTruthy();
    expect(screen.getByTestId('realtime-voice-dock')).toBeTruthy();
    expect(screen.getByText('voice-orb')).toBeTruthy();
    expect(screen.getByText('prompt-enabled')).toBeTruthy();
    expect(latestPromptInputProps.realtimeVoiceActive).toBe(true);
    expect(keyboardDismissSpy).toHaveBeenCalledTimes(1);

    const textOrder = collectRenderedText(toJSON());
    expect(textOrder.indexOf('voice-orb')).toBeLessThan(textOrder.indexOf('prompt-enabled'));
  });

  it('renders realtime voice transcript messages as normal chat bubbles above the orb', async () => {
    mockRealtimeVoiceState = {
      ...mockRealtimeVoiceState,
      isActive: true,
      isCapturing: true,
      messages: [
        { id: 'user-1', role: 'user', text: 'Can you hear me?' },
        { id: 'assistant-1', role: 'assistant', text: 'Yes, I can hear you.' },
      ],
      status: 'connected',
    };

    const { toJSON } = await render(<ChatScreen {...baseProps} />);

    expect(screen.getByText('Can you hear me?')).toBeTruthy();
    expect(screen.getByText('Yes, I can hear you.')).toBeTruthy();
    expect(screen.getByText('voice-orb')).toBeTruthy();

    const textOrder = collectRenderedText(toJSON());
    expect(textOrder.indexOf('Can you hear me?')).toBeLessThan(textOrder.indexOf('voice-orb'));
    expect(textOrder.indexOf('Yes, I can hear you.')).toBeLessThan(textOrder.indexOf('voice-orb'));
    expect(textOrder.indexOf('voice-orb')).toBeLessThan(textOrder.indexOf('prompt-enabled'));
  });

  it('notifies the host when realtime voice transcript messages change', async () => {
    const onRealtimeTranscriptMessagesChange = jest.fn();
    mockRealtimeVoiceState = {
      ...mockRealtimeVoiceState,
      messages: [
        { id: 'user-1', role: 'user', text: 'Save this voice chat', isStreaming: false },
      ],
    };

    await render(
      <ChatScreen
        {...baseProps}
        onRealtimeTranscriptMessagesChange={onRealtimeTranscriptMessagesChange}
      />
    );

    expect(onRealtimeTranscriptMessagesChange).toHaveBeenCalledWith(mockRealtimeVoiceState.messages);
  });

  it('does not duplicate realtime transcript messages already mirrored into chat state', async () => {
    mockRealtimeVoiceState = {
      ...mockRealtimeVoiceState,
      isActive: true,
      messages: [{ id: 'user-1', role: 'user', text: 'Already saved' }],
      status: 'connected',
    };

    await render(
      <ChatScreen
        {...baseProps}
        messages={[{ id: 'realtime-voice-user-1', role: 'user', content: 'Already saved' }]}
      />
    );

    expect(screen.getAllByText('Already saved')).toHaveLength(1);
  });

  it('clears stale realtime voice session state when the reset key changes', async () => {
    const { rerender } = await render(<ChatScreen {...baseProps} realtimeVoiceResetKey={0} />);

    expect(mockRealtimeResetSession).not.toHaveBeenCalled();

    await rerender(<ChatScreen {...baseProps} realtimeVoiceResetKey={1} />);

    expect(mockRealtimeResetSession).toHaveBeenCalledTimes(1);
  });
});
