import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { act, render, fireEvent } from '@testing-library/react-native';

import { StandardMessage } from '../../components/MessageBubble/StandardMessage';
import type { Message } from '../../types';

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn().mockResolvedValue(undefined),
}));

const mockToggleSpeech = jest.fn();
const mockStopSpeech = jest.fn();
const mockTogglePlaybackPaused = jest.fn();
const mockSubmitMessageFeedback = jest.fn().mockResolvedValue(undefined);
const mockVoice = {
  elapsedSeconds: 2,
  isPaused: false,
  isPreparing: false,
  isSpeaking: false,
  stopSpeech: mockStopSpeech,
  togglePlaybackPaused: mockTogglePlaybackPaused,
  toggleSpeech: mockToggleSpeech,
  voiceStatus: 'ready',
};

jest.mock('../../components/Icon', () => require('../helpers/mock-modules').createIconMockModule());

jest.mock('../../components/MessageBubble/MessageBubbleContent', () => ({
  MessageBubbleContent: ({ message, isUser: _isUser, onCopyPress }: any) => {
    const ReactMod = require('react');
    const { Text: TextComp, View: ViewComp, TouchableOpacity } = require('react-native');
    return ReactMod.createElement(ViewComp, { testID: 'bubble-content' },
      ReactMod.createElement(TextComp, null, message.content),
      ReactMod.createElement(TouchableOpacity, { onPress: onCopyPress, testID: 'bubble-copy' },
        ReactMod.createElement(TextComp, null, 'Bubble Copy')
      )
    );
  },
}));

jest.mock('../../components/MessageBubble/MessageActions', () => ({
  MessageActions: ({ onSpeakPress, onCopyPress, onSharePress, onRatingPress, rating: _rating, copied, isSpeaking, privateChat }: any) => {
    const ReactMod = require('react');
    const { Text: TextComp, View: ViewComp, TouchableOpacity } = require('react-native');
    return ReactMod.createElement(ViewComp, { testID: 'message-actions' },
      !privateChat && ReactMod.createElement(TouchableOpacity, { onPress: onSpeakPress, testID: 'speak-btn' },
        ReactMod.createElement(TextComp, null, isSpeaking ? 'Stop' : 'Listen')
      ),
      ReactMod.createElement(TouchableOpacity, { onPress: onCopyPress, testID: 'copy-btn' },
        ReactMod.createElement(TextComp, null, copied ? 'Copied' : 'Copy')
      ),
      !privateChat && ReactMod.createElement(TouchableOpacity, { onPress: onSharePress, testID: 'share-btn' },
        ReactMod.createElement(TextComp, null, 'Share')
      ),
      !privateChat && ReactMod.createElement(TouchableOpacity, { onPress: () => onRatingPress(1), testID: 'rate-up' },
        ReactMod.createElement(TextComp, null, 'Up')
      ),
      !privateChat && ReactMod.createElement(TouchableOpacity, { onPress: () => onRatingPress(-1), testID: 'rate-down' },
        ReactMod.createElement(TextComp, null, 'Down')
      )
    );
  },
}));

jest.mock('../../components/math/MathMessageContent', () => ({
  MathMessageContent: ({ content }: any) => {
    const ReactMod = require('react');
    const { Text: TextComp } = require('react-native');
    return ReactMod.createElement(TextComp, null, content);
  },
}));

jest.mock('../../components/ToolUsageList', () => ({
  ToolUsageList: ({ toolEvents }: any) => {
    const ReactMod = require('react');
    const { Text: TextComp, View: ViewComp } = require('react-native');
    return ReactMod.createElement(ViewComp, { testID: 'tool-usage' },
      ReactMod.createElement(TextComp, null, `${toolEvents.length} events`)
    );
  },
}));

jest.mock('../../components/SourcesList', () => ({
  SourcesList: ({ sources }: any) => {
    const ReactMod = require('react');
    const { Text: TextComp, View: ViewComp } = require('react-native');
    return ReactMod.createElement(ViewComp, { testID: 'sources-list' },
      ReactMod.createElement(TextComp, null, `${sources.length} sources`)
    );
  },
}));

jest.mock('../../hooks/useMessageVoice', () => ({
  useMessageVoice: () => mockVoice,
}));

jest.mock('../../streaming/useStreamingStore', () => ({
  useStreamingStore: () => false, // return boolean for isStreaming when queried via selector
}));

jest.mock('../../utils/glass', () => ({
  isGlassEffectSupported: () => false,
}));

jest.mock('../../api/messages', () => ({
  submitMessageFeedback: (...args: unknown[]) => mockSubmitMessageFeedback(...args),
}));

jest.mock('../../logger', () => ({
  mobileLogger: {
    error: jest.fn(),
  },
}));

describe('StandardMessage', () => {
  const createMessage = (overrides: Partial<Message> = {}): Message => ({
    id: 'msg-1',
    role: 'assistant',
    content: 'Hello world',
    createdAt: Date.now(),
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockVoice.isSpeaking = false;
  });

  it('returns null when message is null', async () => {
    const { toJSON } = await render(<StandardMessage message={null as any} />);
    expect(toJSON()).toBeNull();
  });

  it('renders assistant message with actions, tools, sources, and rating updates', async () => {
    const message = createMessage({
      role: 'assistant',
      rating: 0,
      sources: [{ url: 'https://example.com' }],
      toolEvents: [{ toolName: 'test', success: true } as any],
    });
    const { getByText, getByTestId, rerender } = await render(<StandardMessage message={message} />);
    expect(getByText('Hello world')).toBeTruthy();
    expect(getByTestId('message-actions')).toBeTruthy();
    expect(getByTestId('tool-usage')).toBeTruthy();
    expect(getByTestId('sources-list')).toBeTruthy();

    await rerender(<StandardMessage message={{ ...message, rating: 1 }} />);
    expect(getByTestId('message-actions')).toBeTruthy();
  });

  it('renders user message without assistant-only affordances', async () => {
    const message = createMessage({
      role: 'user',
      sources: [{ url: 'https://example.com' }],
      toolEvents: [{ toolName: 'test', success: true } as any],
    });
    const { getByLabelText, getByText, queryByTestId } = await render(
      <StandardMessage message={message} />
    );
    expect(getByText('Hello world')).toBeTruthy();
    expect(getByLabelText('Copy message')).toBeTruthy();
    expect(queryByTestId('message-actions')).toBeNull();
    expect(queryByTestId('tool-usage')).toBeNull();
    expect(queryByTestId('sources-list')).toBeNull();
  });

  it('omits empty or undefined tool/source lists', async () => {
    const message = createMessage({
      role: 'assistant',
      sources: [],
      toolEvents: [],
    });
    const { queryByTestId } = await render(<StandardMessage message={message} />);
    expect(queryByTestId('tool-usage')).toBeNull();
    expect(queryByTestId('sources-list')).toBeNull();

    const omittedMessage = createMessage({
      role: 'assistant',
      sources: undefined,
      toolEvents: undefined,
    });
    const omitted = await render(<StandardMessage message={omittedMessage} />);
    expect(omitted.queryByTestId('tool-usage')).toBeNull();
    expect(omitted.queryByTestId('sources-list')).toBeNull();
  });

  it('wires assistant action controls', async () => {
    const message = createMessage({ role: 'assistant' });
    const { getByTestId } = await render(<StandardMessage message={message} />);
    await act(async () => {
      fireEvent.press(getByTestId('bubble-copy'));
      await Promise.resolve();
    });
    await fireEvent.press(getByTestId('speak-btn'));
    await fireEvent.press(getByTestId('share-btn'));
    await fireEvent.press(getByTestId('rate-up'));
  });

  it.each([
    ['assistant', 'msg-speaking'],
    ['assistant', 'realtime-voice-speaking'],
  ])('renders and stops %s speech playback for %s', async (role, id) => {
    mockVoice.isSpeaking = true;
    const { getByLabelText } = await render(
      <StandardMessage message={createMessage({ id, role: role as Message['role'] })} />
    );

    await fireEvent.press(getByLabelText('Stop speech playback'));

    expect(mockStopSpeech).toHaveBeenCalled();
  });

  it('restores the prior rating when feedback submission fails', async () => {
    mockSubmitMessageFeedback.mockRejectedValueOnce(new Error('feedback failed'));
    const { getByTestId } = await render(
      <StandardMessage message={createMessage({ rating: 0 })} />
    );

    await fireEvent.press(getByTestId('rate-up'));

    expect(mockSubmitMessageFeedback).toHaveBeenCalledWith('msg-1', 1);
  });

  it('keeps copy but hides output actions for private assistant messages', async () => {
    const message = createMessage({ role: 'assistant' });
    const { getByTestId, queryByTestId } = await render(
      <StandardMessage message={message} privateChat={true} />
    );

    expect(getByTestId('copy-btn')).toBeTruthy();
    expect(queryByTestId('speak-btn')).toBeNull();
    expect(queryByTestId('share-btn')).toBeNull();
    expect(queryByTestId('rate-up')).toBeNull();
    expect(queryByTestId('rate-down')).toBeNull();
  });

  it('renders realtime assistant transcripts without a bubble and with icon-only actions', async () => {
    const message = createMessage({
      id: 'realtime-voice-assistant-reply-1',
      role: 'assistant',
      content: 'Voice reply',
      createdAt: 1710000000000,
    });
    const { getByLabelText, getByText, queryByTestId } = await render(
      <StandardMessage message={message} />
    );

    expect(getByText('Voice reply')).toBeTruthy();
    expect(queryByTestId('bubble-content')).toBeNull();
    expect(getByLabelText('Copy message')).toBeTruthy();
    expect(getByLabelText('Listen to message')).toBeTruthy();
    expect(getByLabelText('Message details')).toBeTruthy();

    await fireEvent.press(getByLabelText('Message details'));
    expect(queryByTestId('message-actions')).toBeNull();
  });

  it('hides realtime transcript listen action in private chat', async () => {
    const message = createMessage({
      id: 'realtime-voice-assistant-reply-private',
      role: 'assistant',
      content: 'Private voice reply',
      createdAt: 1710000000000,
    });
    const { getByLabelText, queryByLabelText } = await render(
      <StandardMessage message={message} privateChat={true} />
    );

    expect(getByLabelText('Copy message')).toBeTruthy();
    expect(queryByLabelText('Listen to message')).toBeNull();
    expect(getByLabelText('Message details')).toBeTruthy();
  });

  it('resets copy confirmation after the feedback timer', async () => {
    jest.useFakeTimers();
    const { getByTestId } = await render(<StandardMessage message={createMessage()} />);

    fireEvent.press(getByTestId('bubble-copy'));
    await act(async () => { await jest.runAllTimersAsync(); });

    expect(getByTestId('copy-btn')).toBeTruthy();
    jest.useRealTimers();
  });
});
