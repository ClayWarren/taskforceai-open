import type { VoiceAdapter } from '../types';
import { getVoiceLogger } from '../logger';
import { VOICE_CANCELLED_MESSAGE } from '../errors';

type SpeechRecognitionLike = {
  interimResults: boolean;
  maxAlternatives: number;
  lang: string;
  start: () => void;
  stop: () => void;
  addEventListener: (type: 'result' | 'error' | 'end', listener: (event: unknown) => void) => void;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }
}

const errs: Record<string, string> = {
  'not-available': 'Speech recognition is not available in this browser.',
  'not-allowed': 'Microphone permission denied.',
  'service-not-allowed': 'Speech service not allowed.',
  'no-speech': 'No speech detected.',
  'audio-capture': 'Audio capture failed.',
  network: 'Network error.',
  'language-not-supported': 'Language not supported.',
  aborted: 'Voice input cancelled.',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const getErrorName = (value: unknown): string | undefined => {
  if (!isRecord(value)) return undefined;
  const name = value['name'];
  return typeof name === 'string' ? name : undefined;
};

const getEventError = (value: unknown): string | undefined => {
  if (!isRecord(value)) return undefined;
  const error = value['error'];
  return typeof error === 'string' ? error : undefined;
};

const getEventTranscript = (value: unknown): string => {
  if (!isRecord(value)) return '';
  const results = value['results'];
  if (!isRecord(results)) return '';
  const firstResult = results['0'];
  if (!isRecord(firstResult)) return '';
  const firstAlt = firstResult['0'];
  if (!isRecord(firstAlt)) return '';
  const transcript = firstAlt['transcript'];
  return typeof transcript === 'string' ? transcript : '';
};

const formatListenError = (value: unknown): string => {
  if (typeof value === 'string') {
    return errs[value] ?? `Error: ${value}`;
  }
  if (value instanceof Error) {
    return value.message;
  }
  return 'Voice input failed.';
};

const MAX_RECORDING_DURATION_MS = 60_000;

export class WebVoiceAdapter implements VoiceAdapter {
  private ctor: SpeechRecognitionCtor | null = null;
  private cur: SpeechRecognitionLike | null = null;
  private recorder: MediaRecorder | null = null;
  private recordChunks: Blob[] = [];
  private recordStream: MediaStream | null = null;
  private listenCanceled = false;
  private forceListenCancel: (() => void) | null = null;
  private pendingRecordCancel: (() => void) | null = null;

  async init() {
    if (typeof window === 'undefined') throw new Error('Window missing');
    this.ctor = this.getRecognitionCtor();
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        (await navigator.mediaDevices.getUserMedia({ audio: true }))
          .getTracks()
          .forEach((t) => t.stop());
      } catch (error) {
        const logger = getVoiceLogger();
        const name = getErrorName(error);
        if (name && ['NotAllowedError', 'PermissionDeniedError'].includes(name)) {
          logger.warn('Voice adapter permission denied', { error });
          throw new Error(errs['not-allowed'], { cause: error });
        }
        // Non-permission errors are silently ignored during init
        logger.debug('Voice adapter getUserMedia error ignored', { error });
      }
    }
  }

  private getRecognitionCtor(): SpeechRecognitionCtor | null {
    if (typeof window === 'undefined') return null;
    return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
  }

  private getSpeechSynthesis(): SpeechSynthesis {
    if (typeof window === 'undefined') {
      throw new Error('Window missing');
    }
    const speechSynthesis = window.speechSynthesis;
    if (!speechSynthesis || typeof speechSynthesis.speak !== 'function') {
      throw new Error('Speech API unsupported');
    }
    return speechSynthesis;
  }

  async speak(text: string): Promise<void> {
    return new Promise((res, rej) => {
      let speechSynthesis: SpeechSynthesis;
      try {
        speechSynthesis = this.getSpeechSynthesis();
      } catch (error) {
        rej(error);
        return;
      }
      const u = new SpeechSynthesisUtterance(text);
      u.addEventListener('end', () => res());
      u.addEventListener('error', (event) => {
        const error = getEventError(event);
        rej(new Error(error || 'Speak failed', { cause: event }));
      });
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    });
  }

  async listen(): Promise<string> {
    if (!this.ctor) {
      await this.init();
      this.ctor = this.getRecognitionCtor();
    }
    if (this.cur || this.recorder || this.pendingRecordCancel) await this.cancel();
    const ctor = this.ctor;
    if (!ctor) {
      throw new Error(errs['not-available']);
    }
    this.listenCanceled = false;
    return new Promise((res, rej) => {
      const r = new ctor();
      this.cur = r;
      r.interimResults = false;
      r.maxAlternatives = 1;
      r.lang = navigator.language || 'en-US';
      let done = false;
      const finish = (v: unknown, isErr = false) => {
        if (done) return;
        done = true;
        if (this.forceListenCancel) {
          this.forceListenCancel = null;
        }
        const cancelled = this.listenCanceled;
        this.listenCanceled = false;
        this.cur = null;
        if (isErr) {
          rej(new Error(formatListenError(v), { cause: v }));
          return;
        }
        if (cancelled) {
          rej(new Error(VOICE_CANCELLED_MESSAGE, { cause: v }));
          return;
        }
        res(typeof v === 'string' ? v : '');
      };
      this.forceListenCancel = () => finish(new Error(VOICE_CANCELLED_MESSAGE), true);
      r.addEventListener('result', (event) => finish(getEventTranscript(event)));
      r.addEventListener('error', (event) => finish(getEventError(event) ?? event, true));
      r.addEventListener('end', () => finish(''));
      try {
        r.start();
      } catch (error) {
        finish(error, true);
      }
    });
  }

  async record(): Promise<{ data: string; format: string }> {
    if (this.cur || this.recorder || this.pendingRecordCancel) await this.cancel();

    return new Promise((resolve, reject) => {
      let stopTimer: ReturnType<typeof setTimeout> | null = null;
      let settled = false;
      let cancelled = false;

      const clearStopTimer = () => {
        if (stopTimer) {
          clearTimeout(stopTimer);
          stopTimer = null;
        }
      };

      const stopRecordStream = () => {
        if (this.recordStream) {
          this.recordStream.getTracks().forEach((t) => t.stop());
          this.recordStream = null;
        }
      };

      const cleanup = () => {
        clearStopTimer();
        this.pendingRecordCancel = null;
      };

      const rejectOnce = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      const resolveOnce = (value: { data: string; format: string }) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };

      this.pendingRecordCancel = () => {
        if (cancelled) return;
        cancelled = true;

        if (this.recorder && this.recorder.state !== 'inactive') {
          try {
            this.recorder.stop();
          } catch (error) {
            this.recorder = null;
            stopRecordStream();
            rejectOnce(new Error('Failed to stop recording', { cause: error }));
          }
          return;
        }

        this.recorder = null;
        stopRecordStream();
        rejectOnce(new Error(VOICE_CANCELLED_MESSAGE));
      };

      void (async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            rejectOnce(new Error(VOICE_CANCELLED_MESSAGE));
            return;
          }

          this.recordStream = stream;
          this.recorder = new MediaRecorder(this.recordStream);
          this.recordChunks = [];

          this.recorder.ondataavailable = (e) => {
            if (e.data.size > 0) this.recordChunks.push(e.data);
          };

          this.recorder.onstop = () => {
            clearStopTimer();
            const mimeType = this.recorder?.mimeType ?? 'audio/webm';
            const wasCancelled = cancelled;

            this.recorder = null;
            stopRecordStream();

            if (wasCancelled) {
              rejectOnce(new Error(VOICE_CANCELLED_MESSAGE));
              return;
            }

            const blob = new Blob(this.recordChunks, { type: mimeType });
            const reader = new FileReader();
            reader.onloadend = () => {
              const result = reader.result as string;
              const base64data = result.split(',')[1] || '';
              let format = 'webm';
              if (mimeType.includes('mp3') || mimeType.includes('mpeg')) {
                format = 'mp3';
              } else if (mimeType.includes('wav')) {
                format = 'wav';
              }
              resolveOnce({ data: base64data, format });
            };
            reader.addEventListener('error', () =>
              rejectOnce(new Error('Failed to read recorded audio'))
            );
            reader.readAsDataURL(blob);
          };

          this.recorder.start();
          stopTimer = setTimeout(() => {
            if (this.recorder && this.recorder.state !== 'inactive') {
              try {
                this.recorder.stop();
              } catch (error) {
                rejectOnce(new Error('Failed to stop recording', { cause: error }));
              }
            }
          }, MAX_RECORDING_DURATION_MS);
        } catch (error) {
          this.recorder = null;
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

  async cancel() {
    window.speechSynthesis?.cancel();
    if (this.cur) {
      this.listenCanceled = true;
    }
    try {
      this.cur?.stop();
    } catch (error) {
      getVoiceLogger().warn('Voice adapter stop failed', { error });
      this.forceListenCancel?.();
    }
    this.cur = null;

    if (this.pendingRecordCancel) {
      try {
        this.pendingRecordCancel();
      } catch (error) {
        getVoiceLogger().warn('MediaRecorder stop failed', { error });
      }
    }
  }
}
