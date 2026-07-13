import type { RealtimeVoiceTranscriptMessage } from '@taskforceai/client-runtime';
import type { Message } from '@taskforceai/client-core/chat/types';

const REALTIME_VOICE_CHAT_MESSAGE_PREFIX = 'realtime-voice-';

export type RealtimeVoiceChatTranscriptMessage = {
  id: string;
  role: RealtimeVoiceTranscriptMessage['role'];
  text: string;
  isStreaming?: boolean;
  isEphemeral?: boolean;
  chatMessageId: string;
};

export type RealtimeVoiceChatTranscriptUpdate = {
  normalizedMessages: RealtimeVoiceChatTranscriptMessage[];
  persistableMessages: RealtimeVoiceChatTranscriptMessage[];
  now: number;
  apply: (previous: Message[]) => Message[];
};

export const toRealtimeVoiceChatMessageId = (messageId: string): string =>
  `${REALTIME_VOICE_CHAT_MESSAGE_PREFIX}${messageId}`;

export const isRealtimeVoiceChatMessage = (message: Pick<Message, 'id'>): boolean =>
  message.id.startsWith(REALTIME_VOICE_CHAT_MESSAGE_PREFIX);

export const createRealtimeVoiceChatTranscriptUpdate = (
  transcriptMessages: RealtimeVoiceTranscriptMessage[],
  now = Date.now()
): RealtimeVoiceChatTranscriptUpdate => {
  const normalizedMessages = transcriptMessages
    .filter((message) => message.isEphemeral !== true)
    .map((message) => {
      const text = message.text.trim();
      return {
        id: message.id,
        role: message.role,
        text,
        isStreaming: message.isStreaming,
        isEphemeral: message.isEphemeral,
        chatMessageId: toRealtimeVoiceChatMessageId(message.id),
      };
    })
    .filter((message) => message.text.length > 0);

  const nextIds = new Set(normalizedMessages.map((message) => message.chatMessageId));
  const persistableMessages = normalizedMessages.filter(
    (message) => !message.isEphemeral && !message.isStreaming
  );

  return {
    normalizedMessages,
    persistableMessages,
    now,
    apply: (previous) => {
      if (normalizedMessages.length === 0) {
        const hasStreamingRealtimeMessage = previous.some(
          (message) => isRealtimeVoiceChatMessage(message) && message.isStreaming === true
        );
        if (!hasStreamingRealtimeMessage) {
          return previous;
        }
        return previous.filter(
          (message) => !isRealtimeVoiceChatMessage(message) || message.isStreaming !== true
        );
      }

      const existingById = new Map(previous.map((message) => [message.id, message]));
      const retainedMessages = previous.filter((message) => {
        if (!isRealtimeVoiceChatMessage(message)) {
          return true;
        }
        if (nextIds.has(message.id)) {
          return false;
        }
        return message.isStreaming !== true;
      });

      const nextTranscriptMessages: Message[] = normalizedMessages.map((message) => {
        const existing = existingById.get(message.chatMessageId);
        const createdAt = existing?.createdAt ?? now;
        return {
          id: message.chatMessageId,
          role: message.role,
          content: message.text,
          isStreaming: message.isStreaming ?? false,
          sources: [],
          toolEvents: [],
          createdAt,
          updatedAt: now,
        };
      });

      return [...retainedMessages, ...nextTranscriptMessages];
    },
  };
};
