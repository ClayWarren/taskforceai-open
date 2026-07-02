import { describe, expect, it } from 'bun:test';

import { getRealtimeVoiceActivityLabel } from './RealtimeVoiceSessionPanel';

describe('getRealtimeVoiceActivityLabel', () => {
  it('prioritizes live activity over a stale connecting status', () => {
    expect(
      getRealtimeVoiceActivityLabel({
        isCapturing: true,
        isPlaying: false,
      })
    ).toBe('Listening');
    expect(
      getRealtimeVoiceActivityLabel({
        isCapturing: false,
        isPlaying: true,
      })
    ).toBe('Speaking');
    expect(
      getRealtimeVoiceActivityLabel({
        isCapturing: false,
        isPlaying: false,
      })
    ).toBe('Voice session');
  });

  it('renders the voice surface without exposing setup as a connecting state', () => {
    expect(
      getRealtimeVoiceActivityLabel({
        isCapturing: false,
        isPlaying: false,
      })
    ).toBe('Voice session');
  });
});
