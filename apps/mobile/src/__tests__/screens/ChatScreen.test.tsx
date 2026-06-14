import React from 'react';
import { act, render, screen } from '@testing-library/react-native';

import { ChatScreen } from '../../screens/ChatScreen';
import type { Message } from '../../types';

const mockScrollToOffset = jest.fn();
let latestPromptInputProps: any = null;
let latestFlashListProps: any = null;

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
    defaultModelId: 'openai/gpt-5.5',
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
    MessageBubble: ({ message }: any) => react.createElement(Text, null, message.content),
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
    latestPromptInputProps = null;
    latestFlashListProps = null;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows empty-state logo when there are no messages', () => {
    render(<ChatScreen {...baseProps} />);
    expect(screen.getByLabelText('TaskForceAI logo')).toBeTruthy();
  });

  it('loads public model data before authentication', () => {
    render(<ChatScreen {...baseProps} isAuthenticated={false} />);
    expect(mockUseModelSelectorQuery).toHaveBeenCalledWith();
  });

  it('renders rate limit banner for rate limit errors', () => {
    const messages: Message[] = [{ id: 'msg-1', role: 'user', content: 'hello' }];
    render(
      <ChatScreen
        {...baseProps}
        messages={messages}
        errorMessage="Rate limit exceeded"
      />
    );

    expect(screen.getByText('rate-limit:Rate limit exceeded')).toBeTruthy();
  });

  it('renders generic error text when error is not a rate limit error', () => {
    const messages: Message[] = [{ id: 'msg-2', role: 'assistant', content: 'done' }];
    render(
      <ChatScreen
        {...baseProps}
        messages={messages}
        errorMessage="Unexpected error"
      />
    );

    expect(screen.getByText('Unexpected error')).toBeTruthy();
  });

  it('shows computer theater when computer use is enabled', () => {
    render(<ChatScreen {...baseProps} computerUseEnabled={true} isStreaming={true} />);
    expect(screen.getByText('computer-theater')).toBeTruthy();
  });

  it('renders messages in the correct order: user → thinking → reply (Hardening TF-0222)', () => {
    const messages: Message[] = [
      { id: 'user-msg', role: 'user', content: 'User Question' },
      { id: 'thinking-msg', role: 'assistant', content: 'Thinking...', isAgentStatus: true },
      { id: 'reply-msg', role: 'assistant', content: 'Agent Reply' },
    ];

    render(<ChatScreen {...baseProps} messages={messages} />);

    // In our mock FlashList, we render items in order of data array.
    // We verify the sequence of content in the rendered tree.
    const messageTexts = screen.getAllByText(/User Question|Thinking...|Agent Reply/);
    expect(messageTexts).toHaveLength(3);
    expect(messageTexts[0]?.props.children).toBe('User Question');
    expect(messageTexts[1]?.props.children).toBe('Thinking...');
    expect(messageTexts[2]?.props.children).toBe('Agent Reply');
  });

  it('keeps the active agent progress near the composer while streaming', () => {
    const messages: Message[] = [
      { id: 'user-msg', role: 'user', content: 'Run a team task' },
      { id: 'status-msg', role: 'assistant', content: '', isAgentStatus: true },
    ];

    render(
      <ChatScreen
        {...baseProps}
        messages={messages}
        isStreaming={true}
        agentStatuses={[{ id: 'agent-1', label: 'agent-1', state: 'running', progress: 0.4 }]}
      />
    );

    act(() => {
      jest.advanceTimersByTime(80);
    });

    expect(mockScrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: true });
  });

  it('scrolls a newly completed response into view after streaming ends', () => {
    const initialMessages: Message[] = [
      { id: 'user-msg', role: 'user', content: 'Generate a video' },
    ];
    const completedMessages: Message[] = [
      ...initialMessages,
      { id: 'reply-msg', role: 'assistant', content: 'Generated video ready' },
    ];

    const { rerender } = render(<ChatScreen {...baseProps} messages={initialMessages} />);

    rerender(
      <ChatScreen
        {...baseProps}
        messages={completedMessages}
        isStreaming={false}
      />
    );

    act(() => {
      jest.advanceTimersByTime(80);
    });

    expect(mockScrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: true });
  });

  it('controls prompt computer use mode from the chat screen', () => {
    render(<ChatScreen {...baseProps} />);

    expect(latestPromptInputProps.computerUseEnabled).toBe(false);

    act(() => {
      latestPromptInputProps.onComputerUseToggle();
    });

    expect(latestPromptInputProps.computerUseEnabled).toBe(true);
  });

  it('gates older-message pagination on hasMoreMessages', () => {
    const onLoadMoreMessages = jest.fn();
    const messages: Message[] = [{ id: 'msg-1', role: 'user', content: 'hello' }];

    const { rerender } = render(
      <ChatScreen
        {...baseProps}
        messages={messages}
        hasMoreMessages={false}
        onLoadMoreMessages={onLoadMoreMessages}
      />
    );
    expect(latestFlashListProps.onEndReached).toBeUndefined();

    rerender(
      <ChatScreen
        {...baseProps}
        messages={messages}
        hasMoreMessages={true}
        onLoadMoreMessages={onLoadMoreMessages}
      />
    );
    expect(latestFlashListProps.onEndReached).toBe(onLoadMoreMessages);
  });
});
