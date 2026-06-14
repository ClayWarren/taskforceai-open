import type { Logger } from '@taskforceai/shared/logger';

import { defaultAdapterFactory } from './defaultAdapterFactory';
import { detectPlatform } from './detectPlatform';
import { isVoiceCancellationError } from './errors';
import { getVoiceLogger } from './logger';
import type { VoiceAdapter, VoiceAdapterFactory, VoiceStatus } from './types';

type Listener = (status: VoiceStatus, error: Error | null) => void;

const normalizeError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

export class VoiceManager {
  private adapter: VoiceAdapter | null = null;
  private state: { status: VoiceStatus; error: Error | null } = { status: 'idle', error: null };
  private listeners = new Set<Listener>();
  private initPromise: Promise<void> | null = null;
  private adapterGeneration = 0;
  private initSequence = 0;
  private logger: Logger;
  private adapterFactory: VoiceAdapterFactory;

  constructor(
    adapter?: VoiceAdapter,
    logger: Logger = getVoiceLogger(),
    adapterFactory: VoiceAdapterFactory = defaultAdapterFactory
  ) {
    this.adapter = adapter ?? null;
    this.logger = logger;
    this.adapterFactory = adapterFactory;
  }

  getStatus(): VoiceStatus {
    return this.state.status;
  }
  getError(): Error | null {
    return this.state.error;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setAdapter(adapter: VoiceAdapter): void {
    if (this.adapter === adapter) return;
    this.adapterGeneration += 1;
    this.adapter = adapter;
    this.setState('idle', null);
    this.initPromise = null;
  }

  private isCurrentAdapter(
    generation: number,
    adapter: VoiceAdapter | null = this.adapter
  ): adapter is VoiceAdapter {
    return generation === this.adapterGeneration && adapter !== null && this.adapter === adapter;
  }

  private setState(nextStatus: VoiceStatus, nextError: Error | null = null): void {
    if (this.state.status === nextStatus && this.state.error === nextError) return;
    this.state = { status: nextStatus, error: nextError };
    this.notify();
  }

  private async loadAdapter(initGeneration: number): Promise<VoiceAdapter | null> {
    if (this.adapter) return this.adapter;

    const platform = detectPlatform();
    const loadedAdapter = await this.adapterFactory(platform);
    if (initGeneration !== this.adapterGeneration) {
      return null;
    }
    if (initGeneration === this.adapterGeneration && !this.adapter) {
      this.adapter = loadedAdapter;
      return this.adapter;
    }
    return this.adapter === loadedAdapter ? loadedAdapter : null;
  }

  async init(): Promise<void> {
    if (this.state.status === 'ready') return;
    if (this.initPromise) return this.initPromise;
    const initGeneration = this.adapterGeneration;
    const initSequence = ++this.initSequence;
    this.setState('initializing');

    this.initPromise = this.loadAdapter(initGeneration)
      .then(async (adapter) => {
        if (!adapter) {
          return null;
        }
        if (initGeneration !== this.adapterGeneration || this.adapter !== adapter) {
          return null;
        }
        await adapter.init();
        if (initGeneration !== this.adapterGeneration || this.adapter !== adapter) {
          return null;
        }
        return adapter;
      })
      .then((adapter) => {
        if (!adapter) {
          return;
        }
        if (initGeneration !== this.adapterGeneration || this.adapter !== adapter) {
          return;
        }
        this.setState('ready', null);
      })
      .catch((error) => {
        const normalized = normalizeError(error);
        if (initGeneration === this.adapterGeneration) {
          this.setState('error', normalized);
        }
        throw normalized;
      })
      .finally(() => {
        if (this.initSequence === initSequence) {
          this.initPromise = null;
        }
      });

    return this.initPromise;
  }

  async speak(text: string): Promise<void> {
    const adapter = await this.ensureReady();
    const generation = this.adapterGeneration;
    try {
      await adapter.speak(text);
    } catch (error) {
      const normalized = normalizeError(error);
      if (this.isCurrentAdapter(generation, adapter) && !isVoiceCancellationError(normalized)) {
        this.setState('error', normalized);
      }
      throw normalized;
    }
  }

  async listen(): Promise<string> {
    const adapter = await this.ensureReady();
    const generation = this.adapterGeneration;
    try {
      return await adapter.listen();
    } catch (error) {
      const normalized = normalizeError(error);
      if (this.isCurrentAdapter(generation, adapter) && !isVoiceCancellationError(normalized)) {
        this.setState('error', normalized);
      }
      throw normalized;
    }
  }

  async record(): Promise<{ data: string; format: string }> {
    const adapter = await this.ensureReady();
    const generation = this.adapterGeneration;
    try {
      return await adapter.record();
    } catch (error) {
      const normalized = normalizeError(error);
      if (this.isCurrentAdapter(generation, adapter) && !isVoiceCancellationError(normalized)) {
        this.setState('error', normalized);
      }
      throw normalized;
    }
  }

  async cancel(): Promise<void> {
    const adapter = this.adapter;
    const generation = this.adapterGeneration;
    try {
      if (adapter) await adapter.cancel();
    } catch (error) {
      const normalizedError = normalizeError(error);
      if (this.isCurrentAdapter(generation, adapter)) {
        this.setState('error', normalizedError);
      }
      this.logger.error('Voice cancel failed', {
        error: {
          name: normalizedError.name,
          message: normalizedError.message,
          stack: normalizedError.stack,
        },
        status: this.state.status,
      });
      throw normalizedError;
    }
  }

  private async ensureReady(): Promise<VoiceAdapter> {
    if (this.state.status !== 'ready' || !this.adapter) {
      await this.init();
    }
    if (this.state.status !== 'ready' || !this.adapter) {
      throw this.state.error ?? new Error('Voice initialization failed');
    }
    return this.adapter;
  }

  private notify() {
    this.listeners.forEach((listener) => listener(this.state.status, this.state.error));
  }
}

export const voiceManager = new VoiceManager();
