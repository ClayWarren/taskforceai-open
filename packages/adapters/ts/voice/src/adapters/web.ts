import type { VoiceAdapter } from '../types';
import { getVoiceLogger } from '../logger';
import { VOICE_CANCELLED_MESSAGE } from '../errors';
import { BrowserVoiceRecorder } from './browser-recorder';

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

const speechSynthesisCancelErrors = new Set(['canceled', 'cancelled', 'interrupted']);

export class WebVoiceAdapter implements VoiceAdapter {
  private ctor: SpeechRecognitionCtor | null = null;
  private cur: SpeechRecognitionLike | null = null;
  private recorder = new BrowserVoiceRecorder();
  private markListenCanceled: (() => void) | null = null;
  private forceListenCancel: (() => void) | null = null;

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

  speak(text: string): Promise<void> {
    return new Promise((res, rej) => {
      let speechSynthesis: SpeechSynthesis;
      try {
        speechSynthesis = this.getSpeechSynthesis();
      } catch (error) {
        rej(error);
        return;
      }
      const u = new SpeechSynthesisUtterance(text);
      let settled = false;
      const resolveOnce = () => {
        if (settled) return;
        settled = true;
        res();
      };
      const rejectOnce = (error: Error) => {
        if (settled) return;
        settled = true;
        rej(error);
      };
      u.addEventListener('end', resolveOnce);
      u.addEventListener('error', (event) => {
        const error = getEventError(event);
        rejectOnce(
          new Error(
            error && speechSynthesisCancelErrors.has(error)
              ? VOICE_CANCELLED_MESSAGE
              : error || 'Speak failed',
            { cause: event }
          )
        );
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
    if (this.cur || this.recorder.isActive) await this.cancel();
    const ctor = this.ctor;
    if (!ctor) {
      throw new Error(errs['not-available']);
    }
    return new Promise((res, rej) => {
      const r = new ctor();
      this.cur = r;
      r.interimResults = false;
      r.maxAlternatives = 1;
      r.lang = navigator.language || 'en-US';
      let done = false;
      let cancelled = false;
      const markCanceled = () => {
        cancelled = true;
      };
      const clearSession = () => {
        if (this.forceListenCancel === forceCancel) {
          this.forceListenCancel = null;
        }
        if (this.markListenCanceled === markCanceled) {
          this.markListenCanceled = null;
        }
        if (this.cur === r) {
          this.cur = null;
        }
      };
      const finish = (v: unknown, isErr = false) => {
        if (done) return;
        done = true;
        clearSession();
        if (cancelled) {
          rej(new Error(VOICE_CANCELLED_MESSAGE, { cause: v }));
          return;
        }
        if (isErr) {
          rej(new Error(formatListenError(v), { cause: v }));
          return;
        }
        res(typeof v === 'string' ? v : '');
      };
      const forceCancel = () => {
        markCanceled();
        finish(new Error(VOICE_CANCELLED_MESSAGE), true);
      };
      this.markListenCanceled = markCanceled;
      this.forceListenCancel = forceCancel;
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
    if (this.cur || this.recorder.isActive) {
      await this.cancel();
    }

    return this.recorder.record();
  }

  async finishListening() {
    if (this.recorder.isActive) {
      this.recorder.finish();
      return;
    }

    try {
      this.cur?.stop();
    } catch (error) {
      getVoiceLogger().warn('Voice adapter finish failed', { error });
      this.forceListenCancel?.();
    }
  }

  async cancel() {
    if (typeof window !== 'undefined') {
      window.speechSynthesis?.cancel();
    }
    const currentRecognition = this.cur;
    const markCanceled = this.markListenCanceled;
    const forceCancel = this.forceListenCancel;
    markCanceled?.();
    try {
      currentRecognition?.stop();
    } catch (error) {
      getVoiceLogger().warn('Voice adapter stop failed', { error });
      forceCancel?.();
    }
    if (this.cur === currentRecognition) {
      this.cur = null;
    }
    if (this.markListenCanceled === markCanceled) {
      this.markListenCanceled = null;
    }
    if (this.forceListenCancel === forceCancel) {
      this.forceListenCancel = null;
    }

    if (this.recorder.isActive) {
      try {
        await this.recorder.cancel();
      } catch (error) {
        getVoiceLogger().warn('MediaRecorder stop failed', { error });
      }
    }
  }
}
