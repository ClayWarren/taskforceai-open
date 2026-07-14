export const VOICE_CANCELLED_MESSAGE = 'Voice input cancelled.';

export const isVoiceCancellationError = (error: unknown): boolean =>
  error instanceof Error && error.message === VOICE_CANCELLED_MESSAGE;
