import { VOICE_CANCELLED_MESSAGE } from '../errors';
import type { VoiceRecording } from '../types';

const MAX_RECORDING_DURATION_MS = 60_000;

const getRecordingFormat = (mimeType: string): string => {
  if (mimeType.includes('mp3') || mimeType.includes('mpeg')) {
    return 'mp3';
  }
  if (mimeType.includes('wav')) {
    return 'wav';
  }
  return 'webm';
};

const stopStream = (stream: MediaStream | null) => {
  stream?.getTracks().forEach((track) => track.stop());
};

export class BrowserVoiceRecorder {
  private recorder: MediaRecorder | null = null;
  private recordChunks: Blob[] = [];
  private recordStream: MediaStream | null = null;
  private pendingCancel: (() => void) | null = null;
  private pendingFinish: (() => void) | null = null;

  get isActive(): boolean {
    return this.recorder !== null || this.pendingCancel !== null || this.pendingFinish !== null;
  }

  async record(): Promise<VoiceRecording> {
    if (this.isActive) {
      await this.cancel();
    }

    return new Promise((resolve, reject) => {
      let stopTimer: ReturnType<typeof setTimeout> | null = null;
      let settled = false;
      let cancelled = false;
      let finishRequested = false;

      const clearStopTimer = () => {
        if (stopTimer) {
          clearTimeout(stopTimer);
          stopTimer = null;
        }
      };

      const cleanup = () => {
        clearStopTimer();
        this.pendingCancel = null;
        this.pendingFinish = null;
      };

      const rejectOnce = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      const resolveOnce = (value: VoiceRecording) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };

      this.pendingCancel = () => {
        if (cancelled) return;
        cancelled = true;

        if (this.recorder && this.recorder.state !== 'inactive') {
          try {
            this.recorder.stop();
          } catch (error) {
            this.recorder = null;
            stopStream(this.recordStream);
            this.recordStream = null;
            rejectOnce(new Error('Failed to stop recording', { cause: error }));
          }
          return;
        }

        this.recorder = null;
        stopStream(this.recordStream);
        this.recordStream = null;
        rejectOnce(new Error(VOICE_CANCELLED_MESSAGE));
      };

      this.pendingFinish = () => {
        if (settled || cancelled) return;
        finishRequested = true;

        if (this.recorder && this.recorder.state !== 'inactive') {
          try {
            this.recorder.stop();
          } catch (error) {
            this.recorder = null;
            stopStream(this.recordStream);
            this.recordStream = null;
            rejectOnce(new Error('Failed to stop recording', { cause: error }));
          }
        }
      };

      void (async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

          if (cancelled) {
            stopStream(stream);
            rejectOnce(new Error(VOICE_CANCELLED_MESSAGE));
            return;
          }

          this.recordStream = stream;
          this.recorder = new MediaRecorder(this.recordStream);
          this.recordChunks = [];

          this.recorder.ondataavailable = (event) => {
            if (event.data.size > 0) this.recordChunks.push(event.data);
          };

          this.recorder.onstop = () => {
            clearStopTimer();
            const mimeType = this.recorder?.mimeType ?? 'audio/webm';
            const wasCancelled = cancelled;

            this.recorder = null;
            stopStream(this.recordStream);
            this.recordStream = null;

            if (wasCancelled) {
              rejectOnce(new Error(VOICE_CANCELLED_MESSAGE));
              return;
            }

            const blob = new Blob(this.recordChunks, { type: mimeType });
            const reader = new FileReader();
            reader.onloadend = () => {
              const result = reader.result as string;
              const data = result.split(',')[1] || '';
              resolveOnce({ data, format: getRecordingFormat(mimeType) });
            };
            reader.addEventListener('error', () =>
              rejectOnce(new Error('Failed to read recorded audio'))
            );
            reader.readAsDataURL(blob);
          };

          this.recorder.start();
          if (finishRequested) {
            this.finish();
            return;
          }

          stopTimer = setTimeout(() => {
            this.finish();
          }, MAX_RECORDING_DURATION_MS);
        } catch (error) {
          this.recorder = null;
          stopStream(this.recordStream);
          this.recordStream = null;
          rejectOnce(
            new Error(
              'Failed to start recording: ' +
                (error instanceof Error ? error.message : String(error)),
              { cause: error }
            )
          );
        }
      })();
    });
  }

  finish(): void {
    this.pendingFinish?.();
  }

  async cancel(): Promise<void> {
    this.pendingCancel?.();
  }
}
