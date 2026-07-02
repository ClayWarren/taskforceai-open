import { describe, expect, it } from 'bun:test';

import {
  addRealtimeUserTranscript,
  applyRealtimeVoiceTranscriptEvent,
  appendRealtimeAssistantTranscript,
  clearRealtimeActiveUserTranscript,
  getRealtimeTranscriptMessagesSignature,
  RealtimeVoiceTranscriptController,
  setRealtimeActiveUserTranscript,
  upsertRealtimeTranscriptMessage,
  type RealtimeVoiceTranscriptMessage,
} from './realtime-voice-transcript';

describe('realtime voice transcript helpers', () => {
  it('upserts messages while preserving existing position', () => {
    const messages: RealtimeVoiceTranscriptMessage[] = [
      { id: 'user-1', role: 'user', text: 'hello' },
      { id: 'assistant-1', role: 'assistant', text: 'hi' },
    ];

    expect(
      upsertRealtimeTranscriptMessage(messages, {
        id: 'user-1',
        role: 'user',
        text: 'updated',
      })
    ).toEqual([
      { id: 'user-1', role: 'user', text: 'updated' },
      { id: 'assistant-1', role: 'assistant', text: 'hi' },
    ]);
  });

  it('keeps finalized user text where the active placeholder appeared', () => {
    const messages = setRealtimeActiveUserTranscript([], {
      activeMessageId: 'user-active',
      previousActiveMessageId: null,
      text: '',
      isStreaming: true,
      isEphemeral: true,
    });
    const withAssistant = appendRealtimeAssistantTranscript(messages, {
      itemId: 'reply-1',
      text: 'Replying.',
      append: false,
    }).messages;

    expect(
      addRealtimeUserTranscript(withAssistant, {
        itemId: 'user-1',
        transcript: 'Can you hear me?',
        activeMessageId: 'user-active',
        finalMessageMetadata: {
          isStreaming: false,
          isEphemeral: false,
        },
      })
    ).toEqual([
      {
        id: 'user-user-1',
        role: 'user',
        text: 'Can you hear me?',
        isStreaming: false,
        isEphemeral: false,
      },
      {
        id: 'assistant-reply-1',
        role: 'assistant',
        text: 'Replying.',
        isStreaming: false,
      },
    ]);
  });

  it('moves a changing active user placeholder without duplicating it', () => {
    const first = setRealtimeActiveUserTranscript([], {
      activeMessageId: 'user-active',
      previousActiveMessageId: null,
      text: '',
      isStreaming: true,
      isEphemeral: true,
    });
    const second = setRealtimeActiveUserTranscript(first, {
      activeMessageId: 'user-user-1',
      previousActiveMessageId: 'user-active',
      text: '',
      isStreaming: true,
      isEphemeral: true,
    });

    expect(second).toEqual([
      {
        id: 'user-user-1',
        role: 'user',
        text: '',
        isStreaming: true,
        isEphemeral: true,
      },
    ]);
  });

  it('accumulates assistant transcript deltas and finalizes the same message', () => {
    const first = appendRealtimeAssistantTranscript([], {
      itemId: 'reply-1',
      text: 'Working ',
      append: true,
    });
    const second = appendRealtimeAssistantTranscript(first.messages, {
      itemId: 'reply-1',
      text: 'on it',
      append: true,
      accumulatedText: first.text,
    });
    const done = appendRealtimeAssistantTranscript(second.messages, {
      itemId: 'reply-1',
      text: 'Working on it.',
      append: false,
      accumulatedText: second.text,
    });

    expect(done.messages).toEqual([
      {
        id: 'assistant-reply-1',
        role: 'assistant',
        text: 'Working on it.',
        isStreaming: false,
      },
    ]);
  });

  it('clears active placeholders and signatures ignore repeated object identity', () => {
    const messages = [
      {
        id: 'user-active',
        role: 'user' as const,
        text: '',
        isStreaming: true,
        isEphemeral: true,
      },
      { id: 'assistant-1', role: 'assistant' as const, text: 'hello' },
    ];

    expect(clearRealtimeActiveUserTranscript(messages, 'user-active')).toEqual([
      { id: 'assistant-1', role: 'assistant', text: 'hello' },
    ]);
    expect(getRealtimeTranscriptMessagesSignature([{ ...messages[1]! }])).toBe(
      getRealtimeTranscriptMessagesSignature([messages[1]!])
    );
  });

  it('manages active user and assistant streaming state in a controller', () => {
    const controller = new RealtimeVoiceTranscriptController('user-active');

    expect(controller.setActiveUserTranscript({})).toEqual([
      {
        id: 'user-active',
        role: 'user',
        text: '',
        isStreaming: true,
        isEphemeral: true,
      },
    ]);
    controller.appendAssistantText('reply-1', 'Working ', true);
    controller.appendAssistantText('reply-1', 'on it', true);

    expect(
      controller.addUserTranscript({
        itemId: 'user-1',
        transcript: 'Can you hear me?',
        finalMessageMetadata: {
          isStreaming: false,
          isEphemeral: false,
        },
      })
    ).toEqual([
      {
        id: 'user-user-1',
        role: 'user',
        text: 'Can you hear me?',
        isStreaming: false,
        isEphemeral: false,
      },
      {
        id: 'assistant-reply-1',
        role: 'assistant',
        text: 'Working on it',
        isStreaming: true,
      },
    ]);

    expect(controller.finishAssistantText('reply-1', 'Working on it.')).toEqual([
      {
        id: 'user-user-1',
        role: 'user',
        text: 'Can you hear me?',
        isStreaming: false,
        isEphemeral: false,
      },
      {
        id: 'assistant-reply-1',
        role: 'assistant',
        text: 'Working on it.',
        isStreaming: false,
      },
    ]);
    expect(controller.reset()).toEqual([]);
  });

  it('does not create empty assistant messages when final text is unavailable', () => {
    const controller = new RealtimeVoiceTranscriptController('user-active');

    expect(controller.finishAssistantText('reply-1')).toEqual([]);
  });

  it('clears the controller active user transcript placeholder', () => {
    const controller = new RealtimeVoiceTranscriptController('user-active');
    controller.setActiveUserTranscript({ text: 'Listening...' });

    expect(controller.clearActiveUserTranscript()).toEqual([]);
    expect(controller.getMessages()).toEqual([]);
  });

  it('applies realtime transcript server events through the shared controller', () => {
    const controller = new RealtimeVoiceTranscriptController('user-active');

    expect(
      applyRealtimeVoiceTranscriptEvent(
        controller,
        { type: 'speech-started', itemId: 'user-1' },
        {
          activeUserTranscript: {
            getText: () => 'Listening...',
          },
        }
      )
    ).toEqual([
      {
        id: 'user-user-1',
        role: 'user',
        text: 'Listening...',
        isStreaming: true,
        isEphemeral: true,
      },
    ]);
    applyRealtimeVoiceTranscriptEvent(controller, {
      type: 'audio-transcript-delta',
      itemId: 'reply-1',
      delta: 'Hi',
    });

    expect(
      applyRealtimeVoiceTranscriptEvent(
        controller,
        {
          type: 'input-transcription-completed',
          itemId: 'user-1',
          transcript: 'Hello',
        },
        {
          finalUserMessageMetadata: {
            isStreaming: false,
            isEphemeral: false,
          },
        }
      )
    ).toEqual([
      {
        id: 'user-user-1',
        role: 'user',
        text: 'Hello',
        isStreaming: false,
        isEphemeral: false,
      },
      {
        id: 'assistant-reply-1',
        role: 'assistant',
        text: 'Hi',
        isStreaming: true,
      },
    ]);

    expect(
      applyRealtimeVoiceTranscriptEvent(controller, {
        type: 'audio-transcript-done',
        itemId: 'reply-1',
      })
    ).toEqual([
      {
        id: 'user-user-1',
        role: 'user',
        text: 'Hello',
        isStreaming: false,
        isEphemeral: false,
      },
      {
        id: 'assistant-reply-1',
        role: 'assistant',
        text: 'Hi',
        isStreaming: false,
      },
    ]);
  });
});
