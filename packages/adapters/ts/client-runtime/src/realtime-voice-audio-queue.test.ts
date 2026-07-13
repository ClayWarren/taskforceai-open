import { describe, expect, it } from 'bun:test';

import { RealtimeVoiceAudioQueue, RealtimeVoiceAudioSender } from './realtime-voice-audio-queue';

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

  it('preserves unsent audio and turn commit state when a flush send throws', () => {
    const queue = new RealtimeVoiceAudioQueue(3);
    const sent: string[] = [];

    queue.pushAudio('a');
    queue.pushAudio('b');
    queue.pushAudio('c');
    queue.requestTurnCommit();

    expect(() =>
      queue.flush({
        sendAudio: (audio) => {
          sent.push(audio);
          if (audio === 'b') {
            throw new Error('sink unavailable');
          }
        },
        commitTurn: () => sent.push('commit'),
      })
    ).toThrow('sink unavailable');

    expect(sent).toEqual(['a', 'b']);
    expect(queue.size).toBe(2);
    expect(queue.hasPendingTurnCommit).toBe(true);

    queue.flush({
      sendAudio: (audio) => sent.push(`retry:${audio}`),
      commitTurn: () => sent.push('commit'),
    });

    expect(sent).toEqual(['a', 'b', 'retry:b', 'retry:c', 'commit']);
    expect(queue.size).toBe(0);
    expect(queue.hasPendingTurnCommit).toBe(false);
  });
});

describe('RealtimeVoiceAudioSender', () => {
  it('sends serialized events only when the socket is open', () => {
    const sent: string[] = [];
    const socket = {
      readyState: 0,
      send: (data: string) => sent.push(data),
    };
    const sender = new RealtimeVoiceAudioSender({
      getSocket: () => socket,
      serializeEvent: (event) => event.type,
    });

    expect(sender.send({ type: 'response-create' })).toBe(false);
    socket.readyState = 1;

    expect(sender.send({ type: 'response-create' })).toBe(true);
    expect(sent).toEqual(['response-create']);
  });

  it('queues audio and turn commits until the realtime session is ready', () => {
    const sent: string[] = [];
    let ready = false;
    const socket = {
      readyState: 1,
      send: (data: string) => sent.push(data),
    };
    const sender = new RealtimeVoiceAudioSender({
      getSocket: () => socket,
      isReady: () => ready,
      maxPendingAudioChunks: 2,
      serializeEvent: (event) =>
        event.type === 'input-audio-append' ? `audio:${event.audio}` : event.type,
    });

    sender.sendAudioOrQueue('a');
    sender.sendAudioOrQueue('b');
    sender.sendAudioOrQueue('c');
    sender.commitTurnOrQueueResponse();

    expect(sent).toEqual([]);

    ready = true;
    sender.flushPendingAudio();

    expect(sent).toEqual(['audio:b', 'audio:c', 'input-audio-commit', 'response-create']);
  });

  it('clears pending audio and pending turn commits independently', () => {
    const sent: string[] = [];
    let ready = false;
    const socket = {
      readyState: 1,
      send: (data: string) => sent.push(data),
    };
    const sender = new RealtimeVoiceAudioSender({
      getSocket: () => socket,
      isReady: () => ready,
      maxPendingAudioChunks: 2,
      serializeEvent: (event) =>
        event.type === 'input-audio-append' ? `audio:${event.audio}` : event.type,
    });

    sender.sendAudioOrQueue('a');
    sender.commitTurnOrQueueResponse();
    sender.clearPendingTurnCommit();
    ready = true;
    sender.flushPendingAudio();

    expect(sent).toEqual(['audio:a']);

    ready = false;
    sender.sendAudioOrQueue('b');
    sender.commitTurnOrQueueResponse();
    sender.clearPendingAudio();
    ready = true;
    sender.flushPendingAudio();

    expect(sent).toEqual(['audio:a']);
  });
});
