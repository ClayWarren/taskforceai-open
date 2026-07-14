import type { RealtimeVoiceServerEvent } from './realtime-voice';

export interface RealtimeVoiceTranscriptMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  isStreaming?: boolean;
  isEphemeral?: boolean;
}

export const getRealtimeUserTranscriptMessageId = (itemId: string): string => `user-${itemId}`;

export const getRealtimeAssistantTranscriptMessageId = (itemId: string): string =>
  `assistant-${itemId}`;

export const getRealtimeTranscriptMessagesSignature = (
  messages: RealtimeVoiceTranscriptMessage[]
): string =>
  messages
    .map(
      (message) =>
        `${message.id}\u001f${message.role}\u001f${message.text}\u001f${message.isStreaming === true}\u001f${message.isEphemeral === true}`
    )
    .join('\u001e');

export const upsertRealtimeTranscriptMessage = (
  messages: RealtimeVoiceTranscriptMessage[],
  nextMessage: RealtimeVoiceTranscriptMessage
): RealtimeVoiceTranscriptMessage[] => {
  const index = messages.findIndex((message) => message.id === nextMessage.id);
  if (index === -1) {
    return [...messages, nextMessage];
  }

  const nextMessages = [...messages];
  nextMessages[index] = nextMessage;
  return nextMessages;
};

export const setRealtimeActiveUserTranscript = (
  messages: RealtimeVoiceTranscriptMessage[],
  options: {
    activeMessageId: string;
    previousActiveMessageId: string | null;
    text: string;
    isStreaming?: boolean;
    isEphemeral?: boolean;
  }
): RealtimeVoiceTranscriptMessage[] => {
  const nextMessage: RealtimeVoiceTranscriptMessage = {
    id: options.activeMessageId,
    role: 'user',
    text: options.text,
    isStreaming: options.isStreaming,
    isEphemeral: options.isEphemeral,
  };
  const previousIndex =
    options.previousActiveMessageId && options.previousActiveMessageId !== options.activeMessageId
      ? messages.findIndex((message) => message.id === options.previousActiveMessageId)
      : -1;
  if (previousIndex === -1) {
    return upsertRealtimeTranscriptMessage(messages, nextMessage);
  }

  const withoutPrevious = messages.filter((message, index) => {
    if (index === previousIndex) {
      return false;
    }
    return message.id !== options.activeMessageId;
  });
  const insertIndex = Math.min(previousIndex, withoutPrevious.length);
  return [
    ...withoutPrevious.slice(0, insertIndex),
    nextMessage,
    ...withoutPrevious.slice(insertIndex),
  ];
};

export const clearRealtimeActiveUserTranscript = (
  messages: RealtimeVoiceTranscriptMessage[],
  activeMessageId: string | null
): RealtimeVoiceTranscriptMessage[] => {
  if (!activeMessageId) {
    return messages;
  }
  return messages.filter((message) => message.id !== activeMessageId);
};

export const addRealtimeUserTranscript = (
  messages: RealtimeVoiceTranscriptMessage[],
  options: {
    itemId: string;
    transcript: string;
    activeMessageId: string | null;
    finalMessageMetadata?: Pick<RealtimeVoiceTranscriptMessage, 'isStreaming' | 'isEphemeral'>;
  }
): RealtimeVoiceTranscriptMessage[] => {
  const normalizedTranscript = options.transcript.trim();
  if (!normalizedTranscript) {
    return messages;
  }

  const messageId = getRealtimeUserTranscriptMessageId(options.itemId);
  const nextMessage: RealtimeVoiceTranscriptMessage = {
    id: messageId,
    role: 'user',
    text: normalizedTranscript,
    ...options.finalMessageMetadata,
  };
  const activeIndex = options.activeMessageId
    ? messages.findIndex((message) => message.id === options.activeMessageId)
    : -1;
  if (activeIndex === -1) {
    return upsertRealtimeTranscriptMessage(messages, nextMessage);
  }

  const withoutActive = messages.filter((message, index) => {
    if (index === activeIndex) {
      return false;
    }
    return message.id !== messageId;
  });
  const insertIndex = Math.min(activeIndex, withoutActive.length);
  return [...withoutActive.slice(0, insertIndex), nextMessage, ...withoutActive.slice(insertIndex)];
};

export const appendRealtimeAssistantTranscript = (
  messages: RealtimeVoiceTranscriptMessage[],
  options: {
    itemId: string;
    text: string;
    append: boolean;
    accumulatedText?: string;
  }
): {
  messages: RealtimeVoiceTranscriptMessage[];
  text: string;
  messageId: string;
} => {
  const messageId = getRealtimeAssistantTranscriptMessageId(options.itemId);
  const text = options.append ? `${options.accumulatedText ?? ''}${options.text}` : options.text;
  return {
    messageId,
    text,
    messages: upsertRealtimeTranscriptMessage(messages, {
      id: messageId,
      role: 'assistant',
      text,
      isStreaming: options.append,
    }),
  };
};

export class RealtimeVoiceTranscriptController {
  private messages: RealtimeVoiceTranscriptMessage[] = [];
  private readonly textAccumulators = new Map<string, string>();
  private activeUserTranscriptId: string | null = null;

  constructor(private readonly defaultActiveUserTranscriptId: string) {}

  getMessages(): RealtimeVoiceTranscriptMessage[] {
    return this.messages;
  }

  reset(): RealtimeVoiceTranscriptMessage[] {
    this.messages = [];
    this.textAccumulators.clear();
    this.activeUserTranscriptId = null;
    return this.messages;
  }

  setActiveUserTranscript({
    itemId,
    text = '',
    isStreaming = true,
    isEphemeral = true,
  }: {
    itemId?: string;
    text?: string;
    isStreaming?: boolean;
    isEphemeral?: boolean;
  }): RealtimeVoiceTranscriptMessage[] {
    const activeMessageId = itemId
      ? getRealtimeUserTranscriptMessageId(itemId)
      : this.defaultActiveUserTranscriptId;
    const previousActiveMessageId = this.activeUserTranscriptId;
    this.activeUserTranscriptId = activeMessageId;
    this.messages = setRealtimeActiveUserTranscript(this.messages, {
      activeMessageId,
      previousActiveMessageId,
      text,
      isStreaming,
      isEphemeral,
    });
    return this.messages;
  }

  clearActiveUserTranscript(): RealtimeVoiceTranscriptMessage[] {
    this.messages = clearRealtimeActiveUserTranscript(this.messages, this.activeUserTranscriptId);
    this.activeUserTranscriptId = null;
    return this.messages;
  }

  addUserTranscript({
    itemId,
    transcript,
    finalMessageMetadata,
  }: {
    itemId: string;
    transcript: string;
    finalMessageMetadata?: Pick<RealtimeVoiceTranscriptMessage, 'isStreaming' | 'isEphemeral'>;
  }): RealtimeVoiceTranscriptMessage[] {
    this.messages = addRealtimeUserTranscript(this.messages, {
      itemId,
      transcript,
      activeMessageId: this.activeUserTranscriptId,
      finalMessageMetadata,
    });
    this.activeUserTranscriptId = null;
    return this.messages;
  }

  appendAssistantText(
    itemId: string,
    text: string,
    append: boolean
  ): RealtimeVoiceTranscriptMessage[] {
    const messageId = getRealtimeAssistantTranscriptMessageId(itemId);
    const result = appendRealtimeAssistantTranscript(this.messages, {
      itemId,
      text,
      append,
      accumulatedText: this.textAccumulators.get(messageId) ?? '',
    });
    this.textAccumulators.set(messageId, result.text);
    this.messages = result.messages;
    return this.messages;
  }

  finishAssistantText(itemId: string, text?: string): RealtimeVoiceTranscriptMessage[] {
    const messageId = getRealtimeAssistantTranscriptMessageId(itemId);
    const finalText = text ?? this.textAccumulators.get(messageId);
    if (finalText === undefined) {
      return this.messages;
    }

    this.messages = this.appendAssistantText(itemId, finalText, false);
    this.textAccumulators.delete(messageId);
    return this.messages;
  }
}

export interface ApplyRealtimeVoiceTranscriptEventOptions {
  activeUserTranscript?: {
    getText?: (event: RealtimeVoiceServerEvent) => string;
    isStreaming?: boolean;
    isEphemeral?: boolean;
  };
  finalUserMessageMetadata?: Pick<RealtimeVoiceTranscriptMessage, 'isStreaming' | 'isEphemeral'>;
}

const eventField = (event: RealtimeVoiceServerEvent, field: string): unknown =>
  (event as unknown as Record<string, unknown>)[field];

const applySpeechEvent = (
  controller: RealtimeVoiceTranscriptController,
  event: RealtimeVoiceServerEvent,
  options: ApplyRealtimeVoiceTranscriptEventOptions
) =>
  controller.setActiveUserTranscript({
    itemId:
      typeof eventField(event, 'itemId') === 'string'
        ? String(eventField(event, 'itemId'))
        : undefined,
    text: options.activeUserTranscript?.getText?.(event) ?? '',
    isStreaming: options.activeUserTranscript?.isStreaming ?? true,
    isEphemeral: options.activeUserTranscript?.isEphemeral ?? true,
  });

const applyCompletedInputTranscript = (
  controller: RealtimeVoiceTranscriptController,
  event: RealtimeVoiceServerEvent,
  options: ApplyRealtimeVoiceTranscriptEventOptions
) => {
  const itemId = eventField(event, 'itemId');
  const transcript = eventField(event, 'transcript');
  if (typeof itemId !== 'string' || typeof transcript !== 'string') return null;
  return controller.addUserTranscript({
    itemId,
    transcript,
    finalMessageMetadata: options.finalUserMessageMetadata,
  });
};

const applyAssistantDelta = (
  controller: RealtimeVoiceTranscriptController,
  event: RealtimeVoiceServerEvent
) => {
  const itemId = eventField(event, 'itemId');
  const delta = eventField(event, 'delta');
  if (typeof itemId !== 'string' || typeof delta !== 'string') return null;
  return controller.appendAssistantText(itemId, delta, true);
};

const finishAssistantTranscript = (
  controller: RealtimeVoiceTranscriptController,
  event: RealtimeVoiceServerEvent,
  field: 'text' | 'transcript'
) => {
  const itemId = eventField(event, 'itemId');
  if (typeof itemId !== 'string') return null;
  const finalText = eventField(event, field);
  return controller.finishAssistantText(
    itemId,
    typeof finalText === 'string' ? finalText : undefined
  );
};

export const applyRealtimeVoiceTranscriptEvent = (
  controller: RealtimeVoiceTranscriptController,
  event: RealtimeVoiceServerEvent,
  options: ApplyRealtimeVoiceTranscriptEventOptions = {}
): RealtimeVoiceTranscriptMessage[] | null => {
  switch (event.type) {
    case 'speech-started':
    case 'speech-stopped':
      return applySpeechEvent(controller, event, options);
    case 'input-transcription-completed':
      return applyCompletedInputTranscript(controller, event, options);
    case 'audio-transcript-delta':
    case 'text-delta':
      return applyAssistantDelta(controller, event);
    case 'audio-transcript-done':
      return finishAssistantTranscript(controller, event, 'transcript');
    case 'text-done':
      return finishAssistantTranscript(controller, event, 'text');
    default:
      return null;
  }
};
