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
    const chunks = this.audioChunks.splice(0);
    for (const audio of chunks) {
      sink.sendAudio(audio);
    }

    if (this.turnCommitPending) {
      this.turnCommitPending = false;
      sink.commitTurn?.();
    }
  }
}
