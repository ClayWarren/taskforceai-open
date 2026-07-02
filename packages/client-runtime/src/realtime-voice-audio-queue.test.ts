import { describe, expect, it } from 'bun:test';

import { RealtimeVoiceAudioQueue } from './realtime-voice-audio-queue';

describe('RealtimeVoiceAudioQueue', () => {
  it('queues and flushes audio chunks in order', () => {
    const queue = new RealtimeVoiceAudioQueue(3);
    const sent: string[] = [];

    queue.pushAudio('a');
    queue.pushAudio('b');
    queue.flush({ sendAudio: (audio) => sent.push(audio) });

    expect(sent).toEqual(['a', 'b']);
    expect(queue.size).toBe(0);
  });

  it('drops oldest chunks when the queue reaches the cap', () => {
    const queue = new RealtimeVoiceAudioQueue(2);
    const sent: string[] = [];

    queue.pushAudio('a');
    queue.pushAudio('b');
    queue.pushAudio('c');
    queue.flush({ sendAudio: (audio) => sent.push(audio) });

    expect(sent).toEqual(['b', 'c']);
  });

  it('flushes a pending turn commit after queued audio', () => {
    const queue = new RealtimeVoiceAudioQueue(3);
    const sent: string[] = [];

    queue.pushAudio('a');
    queue.requestTurnCommit();
    queue.flush({
      sendAudio: (audio) => sent.push(`audio:${audio}`),
      commitTurn: () => sent.push('commit'),
    });

    expect(sent).toEqual(['audio:a', 'commit']);
    expect(queue.hasPendingTurnCommit).toBe(false);
  });

  it('clears a pending turn commit when no sink handler is supplied', () => {
    const queue = new RealtimeVoiceAudioQueue(3);

    queue.requestTurnCommit();
    queue.flush({ sendAudio: () => undefined });

    expect(queue.hasPendingTurnCommit).toBe(false);
  });

  it('clears queued audio and turn state', () => {
    const queue = new RealtimeVoiceAudioQueue(3);

    queue.pushAudio('a');
    queue.requestTurnCommit();
    queue.clear();

    expect(queue.size).toBe(0);
    expect(queue.hasPendingTurnCommit).toBe(false);
  });

  it('clears a pending turn commit without dropping queued audio', () => {
    const queue = new RealtimeVoiceAudioQueue(3);
    const sent: string[] = [];

    queue.pushAudio('a');
    queue.requestTurnCommit();
    queue.clearTurnCommit();
    queue.flush({
      sendAudio: (audio) => sent.push(audio),
      commitTurn: () => sent.push('commit'),
    });

    expect(sent).toEqual(['a']);
  });
});
