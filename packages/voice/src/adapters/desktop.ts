import type { VoiceAdapter } from '../types';
import { BrowserVoiceRecorder } from './browser-recorder';

declare global {
  interface Window {
    __TAURI__?: {
      invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
    };
  }
}

export class DesktopVoiceAdapter implements VoiceAdapter {
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;
  private recorder = new BrowserVoiceRecorder();

  async init(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      if (!window.__TAURI__?.invoke) {
        throw new Error('Tauri voice bridge is not available.');
      }
      this.isInitialized = true;
    })()
      .catch((error) => {
        this.isInitialized = false;
        throw error;
      })
      .finally(() => {
        this.initPromise = null;
      });

    return this.initPromise;
  }

  async speak(text: string): Promise<void> {
    await this.ensureInvoke('voice_speak', { text });
  }

  async listen(): Promise<string> {
    const result = await this.ensureInvoke('voice_listen');
    if (typeof result !== 'string') {
      throw new Error('Tauri voice bridge returned invalid response.');
    }
    return result;
  }

  async record(): Promise<{ data: string; format: string }> {
    return this.recorder.record();
  }

  async finishListening(): Promise<void> {
    if (this.recorder.isActive) {
      this.recorder.finish();
    }
  }

  async cancel(): Promise<void> {
    if (this.recorder.isActive) {
      await this.recorder.cancel();
      return;
    }
    await this.ensureInvoke('voice_cancel');
  }

  private async ensureInvoke(command: string, args?: Record<string, unknown>): Promise<unknown> {
    await this.init();
    const invoke = window.__TAURI__?.invoke;
    if (!invoke) {
      throw new Error('Tauri voice bridge is not available.');
    }
    return invoke(command, args);
  }
}
