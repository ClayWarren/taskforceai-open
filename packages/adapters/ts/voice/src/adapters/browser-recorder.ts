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
  private recordStream: MediaStream | null = null;
  private pendingCancel: (() => Promise<void>) | null = null;
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
      let recorder: MediaRecorder | null = null;
      let recordStream: MediaStream | null = null;
      const recordChunks: Blob[] = [];
      let settlementPromise: Promise<void> | null = null;
      let resolveSettlement: (() => void) | null = null;

      const waitForSettlement = (): Promise<void> => {
        if (!settlementPromise) {
          settlementPromise = new Promise((resolveCancel) => {
            resolveSettlement = resolveCancel;
          });
        }
        return settlementPromise;
      };

      const clearStopTimer = () => {
        if (stopTimer) {
          clearTimeout(stopTimer);
          stopTimer = null;
        }
      };

      const clearInstanceRefs = () => {
        if (this.recorder === recorder) {
          this.recorder = null;
        }
        if (this.recordStream === recordStream) {
          this.recordStream = null;
        }
        if (this.pendingCancel === cancelSession) {
          this.pendingCancel = null;
        }
        if (this.pendingFinish === finishSession) {
          this.pendingFinish = null;
        }
      };

      const stopRecordStream = () => {
        const stream = recordStream;
        recordStream = null;
        if (this.recordStream === stream) {
          this.recordStream = null;
        }
        stopStream(stream);
      };

      const cleanup = () => {
        clearStopTimer();
        clearInstanceRefs();
        resolveSettlement?.();
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

      const cancelSession = async () => {
        if (cancelled) return;
        cancelled = true;

        if (recorder && recorder.state !== 'inactive') {
          try {
            const settlement = waitForSettlement();
            recorder.stop();
            await settlement;
          } catch (error) {
            const failedRecorder = recorder;
            recorder = null;
            if (this.recorder === failedRecorder) {
              this.recorder = null;
            }
            stopRecordStream();
            rejectOnce(new Error('Failed to stop recording', { cause: error }));
          }
          return;
        }

        recorder = null;
        stopRecordStream();
        rejectOnce(new Error(VOICE_CANCELLED_MESSAGE));
      };

      const finishSession = () => {
        if (settled || cancelled) return;
        finishRequested = true;

        if (recorder && recorder.state !== 'inactive') {
          try {
            recorder.stop();
          } catch (error) {
            const failedRecorder = recorder;
            recorder = null;
            if (this.recorder === failedRecorder) {
              this.recorder = null;
            }
            stopRecordStream();
            rejectOnce(new Error('Failed to stop recording', { cause: error }));
          }
        }
      };

      this.pendingCancel = cancelSession;
      this.pendingFinish = finishSession;

      void (async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

          if (cancelled) {
            stopStream(stream);
            rejectOnce(new Error(VOICE_CANCELLED_MESSAGE));
            return;
          }

          recordStream = stream;
          recorder = new MediaRecorder(recordStream);
          this.recordStream = recordStream;
          this.recorder = recorder;

          recorder.ondataavailable = (event) => {
            if (event.data.size > 0) recordChunks.push(event.data);
          };

          recorder.onstop = () => {
            clearStopTimer();
            const stoppedRecorder = recorder;
            const mimeType = stoppedRecorder?.mimeType ?? 'audio/webm';
            const wasCancelled = cancelled;

            recorder = null;
            if (this.recorder === stoppedRecorder) {
              this.recorder = null;
            }
            stopRecordStream();

            if (wasCancelled) {
              rejectOnce(new Error(VOICE_CANCELLED_MESSAGE));
              return;
            }

            const blob = new Blob(recordChunks, { type: mimeType });
            const reader = new FileReader();
            const handleLoad = () => {
              const result = reader.result;
              if (typeof result !== 'string') {
                rejectOnce(new Error('Failed to read recorded audio'));
                return;
              }
              const data = result.split(',')[1] || '';
              resolveOnce({ data, format: getRecordingFormat(mimeType) });
            };
            const handleError = () => rejectOnce(new Error('Failed to read recorded audio'));
            reader.addEventListener('load', handleLoad);
            reader.addEventListener('loadend', () => {
              if (!reader.error) {
                handleLoad();
              }
            });
            reader.addEventListener('error', handleError);
            reader.readAsDataURL(blob);
          };

          recorder.start();
          if (finishRequested) {
            finishSession();
            return;
          }

          stopTimer = setTimeout(() => {
            finishSession();
          }, MAX_RECORDING_DURATION_MS);
        } catch (error) {
          recorder = null;
          stopRecordStream();
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
    await this.pendingCancel?.();
  }
}
