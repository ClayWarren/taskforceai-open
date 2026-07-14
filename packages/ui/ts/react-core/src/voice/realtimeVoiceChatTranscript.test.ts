import { describe, expect, it } from 'bun:test';

import {
  createRealtimeVoiceChatTranscriptUpdate,
  isRealtimeVoiceChatMessage,
  toRealtimeVoiceChatMessageId,
} from './realtimeVoiceChatTranscript';
import type { Message } from '@taskforceai/client-core/chat/types';

describe('realtime voice chat transcript projection', () => {
  it('projects non-empty transcript messages into chat messages', () => {
    const previous: Message[] = [
      {
        id: 'regular',
        role: 'assistant',
        content: 'keep',
        createdAt: 5,
        updatedAt: 5,
      },
      {
        id: toRealtimeVoiceChatMessageId('old'),
        role: 'assistant',
        content: 'old streaming',
        isStreaming: true,
        createdAt: 10,
        updatedAt: 10,
      },
      {
        id: toRealtimeVoiceChatMessageId('u1'),
        role: 'user',
        content: 'old user',
        isStreaming: false,
        createdAt: 20,
        updatedAt: 20,
      },
    ];

    const update = createRealtimeVoiceChatTranscriptUpdate(
      [
        { id: 'u1', role: 'user', text: '  hello  ' },
        { id: 'empty', role: 'assistant', text: '   ' },
        { id: 'ephemeral', role: 'assistant', text: 'ignored', isEphemeral: true },
        { id: 'a1', role: 'assistant', text: 'answer', isStreaming: true },
      ],
      100
    );

    expect(update.normalizedMessages.map((message) => message.id)).toEqual(['u1', 'a1']);
    expect(update.persistableMessages.map((message) => message.id)).toEqual(['u1']);
    expect(update.apply(previous)).toEqual([
      expect.objectContaining({ id: 'regular' }),
      {
        id: toRealtimeVoiceChatMessageId('u1'),
        role: 'user',
        content: 'hello',
        isStreaming: false,
        sources: [],
        toolEvents: [],
        createdAt: 20,
        updatedAt: 100,
      },
      {
        id: toRealtimeVoiceChatMessageId('a1'),
        role: 'assistant',
        content: 'answer',
        isStreaming: true,
        sources: [],
        toolEvents: [],
        createdAt: 100,
        updatedAt: 100,
      },
    ]);
  });

  it('removes streaming realtime messages when the transcript is empty', () => {
    const previous: Message[] = [
      { id: 'regular', role: 'assistant', content: 'keep' },
      {
        id: toRealtimeVoiceChatMessageId('streaming'),
        role: 'assistant',
        content: 'drop',
        isStreaming: true,
      },
      {
        id: toRealtimeVoiceChatMessageId('final'),
        role: 'user',
        content: 'keep final',
        isStreaming: false,
      },
    ];

    const update = createRealtimeVoiceChatTranscriptUpdate([], 50);

    expect(update.apply(previous)).toEqual([
      expect.objectContaining({ id: 'regular' }),
      expect.objectContaining({ id: toRealtimeVoiceChatMessageId('final') }),
    ]);
  });

  it('returns the existing array when an empty transcript has no streaming realtime messages', () => {
    const previous: Message[] = [
      { id: 'regular', role: 'assistant', content: 'keep' },
      {
        id: toRealtimeVoiceChatMessageId('final'),
        role: 'user',
        content: 'keep final',
        isStreaming: false,
      },
    ];

    const update = createRealtimeVoiceChatTranscriptUpdate([], 50);

    expect(update.apply(previous)).toBe(previous);
  });

  it('identifies realtime voice chat messages by prefix', () => {
    expect(isRealtimeVoiceChatMessage({ id: toRealtimeVoiceChatMessageId('message') })).toBe(true);
    expect(isRealtimeVoiceChatMessage({ id: 'message' })).toBe(false);
  });
});
