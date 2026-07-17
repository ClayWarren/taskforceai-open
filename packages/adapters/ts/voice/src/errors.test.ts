import { describe, expect, it } from 'bun:test';

import { VOICE_CANCELLED_MESSAGE, isVoiceCancellationError } from './errors';

describe('voice/errors', () => {
  it('identifies the canonical cancellation error', () => {
    expect(isVoiceCancellationError(new Error(VOICE_CANCELLED_MESSAGE))).toBe(true);
  });

  it('rejects non-errors and non-cancellation errors', () => {
    expect(isVoiceCancellationError(VOICE_CANCELLED_MESSAGE)).toBe(false);
    expect(isVoiceCancellationError({ message: VOICE_CANCELLED_MESSAGE })).toBe(false);
    expect(isVoiceCancellationError(new Error('Voice input cancelled'))).toBe(false);
    expect(isVoiceCancellationError(new Error('Listen failed'))).toBe(false);
  });
});
