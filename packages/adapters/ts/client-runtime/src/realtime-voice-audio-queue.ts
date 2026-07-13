import { serializeRealtimeVoiceEvent, type RealtimeVoiceClientEvent } from './realtime-voice';

const DEFAULT_WEBSOCKET_OPEN_READY_STATE = 1;

export interface RealtimeVoiceAudioQueueSink {
  sendAudio: (audio: string) => void;
  commitTurn?: () => void;
}

export class RealtimeVoiceAudioQueue {
  private audioChunks: string[] = [];
  private turnCommitPending = false;

  constructor(private readonly maxAudioChunks: number) {}

  get size(): number {
    return this.audioChunks.length;
  }

  get hasPendingTurnCommit(): boolean {
    return this.turnCommitPending;
  }

  clear(): void {
    this.audioChunks = [];
    this.turnCommitPending = false;
  }

  clearTurnCommit(): void {
    this.turnCommitPending = false;
  }

  pushAudio(audio: string): void {
    if (!audio) {
      return;
    }

    this.audioChunks.push(audio);
    if (this.audioChunks.length > this.maxAudioChunks) {
      this.audioChunks.splice(0, this.audioChunks.length - this.maxAudioChunks);
    }
  }

  requestTurnCommit(): void {
    this.turnCommitPending = true;
  }

  flush(sink: RealtimeVoiceAudioQueueSink): void {
    while (this.audioChunks.length > 0) {
      const audio = this.audioChunks[0]!;
      sink.sendAudio(audio);
      this.audioChunks.shift();
    }

    if (this.turnCommitPending) {
      sink.commitTurn?.();
      this.turnCommitPending = false;
    }
  }
}

export interface RealtimeVoiceSocketLike {
  readyState: number;
  send(data: string): void;
}

export interface RealtimeVoiceAudioSenderOptions {
  getSocket: () => RealtimeVoiceSocketLike | null;
  isReady?: () => boolean;
  maxPendingAudioChunks?: number;
  openReadyState?: number;
  serializeEvent?: typeof serializeRealtimeVoiceEvent;
}

export class RealtimeVoiceAudioSender {
  private readonly queue: RealtimeVoiceAudioQueue;
  private readonly isReady: () => boolean;
  private readonly openReadyState: number;
  private readonly serializeEvent: typeof serializeRealtimeVoiceEvent;

  constructor(private readonly options: RealtimeVoiceAudioSenderOptions) {
    this.queue = new RealtimeVoiceAudioQueue(options.maxPendingAudioChunks ?? 0);
    this.isReady = options.isReady ?? (() => true);
    this.openReadyState = options.openReadyState ?? DEFAULT_WEBSOCKET_OPEN_READY_STATE;
    this.serializeEvent = options.serializeEvent ?? serializeRealtimeVoiceEvent;
  }

  send(event: RealtimeVoiceClientEvent): boolean {
    const socket = this.options.getSocket();
    if (!socket || socket.readyState !== this.openReadyState) {
      return false;
    }

    socket.send(this.serializeEvent(event));
    return true;
  }

  sendAudioOrQueue(audio: string): void {
    if (!audio) {
      return;
    }
    if (this.canSendReadyEvents() && this.send({ type: 'input-audio-append', audio })) {
      return;
    }
    this.queue.pushAudio(audio);
  }

  commitTurnOrQueueResponse(): void {
    if (!this.canSendReadyEvents()) {
      this.queue.requestTurnCommit();
      return;
    }

    if (!this.sendCommitAndResponse()) {
      this.queue.requestTurnCommit();
    }
  }

  flushPendingAudio(): void {
    if (!this.canSendReadyEvents()) {
      return;
    }

    this.queue.flush({
      sendAudio: (audio) => {
        if (!this.send({ type: 'input-audio-append', audio })) {
          throw new Error('Realtime voice socket is unavailable.');
        }
      },
      commitTurn: () => {
        if (!this.sendCommitAndResponse()) {
          throw new Error('Realtime voice socket is unavailable.');
        }
      },
    });
  }

  clearPendingAudio(): void {
    this.queue.clear();
  }

  clearPendingTurnCommit(): void {
    this.queue.clearTurnCommit();
  }

  private canSendReadyEvents(): boolean {
    const socket = this.options.getSocket();
    return Boolean(socket && socket.readyState === this.openReadyState && this.isReady());
  }

  private sendCommitAndResponse(): boolean {
    if (!this.send({ type: 'input-audio-commit' })) {
      return false;
    }
    return this.send({ type: 'response-create' });
  }
}
