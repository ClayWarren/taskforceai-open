import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import { Logger } from '@taskforceai/shared/logger';
import { VoiceManager } from './VoiceManager';
import * as detectPlatformModule from './detectPlatform';
import type { VoiceAdapter } from './types';

void vi.mock('./logger', () => ({
  getVoiceLogger: vi.fn(() => new Logger()),
}));

describe('voice/VoiceManager', () => {
  let mockAdapter: VoiceAdapter;
  let mockLogger: Logger;

  beforeEach(() => {
    vi.spyOn(detectPlatformModule, 'detectPlatform').mockReturnValue('web');

    mockAdapter = {
      init: vi.fn().mockResolvedValue(undefined),
      speak: vi.fn().mockResolvedValue(undefined),
      listen: vi.fn().mockResolvedValue('test transcript'),
      record: vi.fn().mockResolvedValue({ data: 'b64', format: 'wav' }),
      cancel: vi.fn().mockResolvedValue(undefined),
    };

    mockLogger = new Logger();
    vi.spyOn(mockLogger, 'debug');
    vi.spyOn(mockLogger, 'info');
    vi.spyOn(mockLogger, 'warn');
    vi.spyOn(mockLogger, 'error');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('creates managers with default, adapter, logger, and factory options', async () => {
      const manager = new VoiceManager();
      expect(manager.getStatus()).toBe('idle');
      expect(manager.getError()).toBeNull();

      expect(new VoiceManager(mockAdapter).getStatus()).toBe('idle');
      expect(new VoiceManager(mockAdapter, mockLogger).getStatus()).toBe('idle');

      const customFactory = vi.fn().mockResolvedValue(mockAdapter);
      await new VoiceManager(undefined, mockLogger, customFactory).init();
      expect(customFactory).toHaveBeenCalled();
    });
  });

  describe('getError', () => {
    it('returns null initially and stores init failures', async () => {
      expect(new VoiceManager(mockAdapter).getError()).toBeNull();
      const failingAdapter: VoiceAdapter = {
        init: vi.fn().mockRejectedValue(new Error('Init failed')),
        speak: vi.fn(),
        listen: vi.fn(),
        record: vi.fn(),
        cancel: vi.fn(),
      };

      const manager = new VoiceManager(failingAdapter);

      await expect((async () => manager.init())()).rejects.toThrow('Init failed');
      expect(manager.getError()).toBeInstanceOf(Error);
      expect(manager.getError()?.message).toBe('Init failed');
    });
  });

  describe('subscribe', () => {
    it('notifies subscribed listeners and honors unsubscribe', async () => {
      const manager = new VoiceManager(mockAdapter);
      const listener = vi.fn();
      const unsubscribe = manager.subscribe(listener);
      expect(typeof unsubscribe).toBe('function');
      await manager.init();
      expect(listener).toHaveBeenCalled();

      listener.mockClear();
      unsubscribe();
      await manager.init();
      expect(listener).not.toHaveBeenCalled();
    });

    it('supports multiple listeners', async () => {
      const manager = new VoiceManager(mockAdapter);
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      manager.subscribe(listener1);
      manager.subscribe(listener2);

      await manager.init();

      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
    });
  });

  describe('setAdapter', () => {
    it('does nothing when setting same adapter', async () => {
      const manager = new VoiceManager(mockAdapter);
      const listener = vi.fn();

      await manager.init();
      manager.subscribe(listener);

      // Setting same adapter should not trigger state change
      manager.setAdapter(mockAdapter);

      expect(listener).not.toHaveBeenCalled();
    });

    it('sets a new adapter and resets initialized state', async () => {
      const manager = new VoiceManager(mockAdapter);
      await manager.init();
      expect(manager.getStatus()).toBe('ready');

      const newAdapter: VoiceAdapter = {
        init: vi.fn().mockResolvedValue(undefined),
        speak: vi.fn(),
        listen: vi.fn(),
        record: vi.fn(),
        cancel: vi.fn(),
      };

      manager.setAdapter(newAdapter);
      expect(manager.getStatus()).toBe('idle');
    });

    it('does not transition to ready from a stale init after adapter swap', async () => {
      let resolveInit: () => void = () => {};
      const slowAdapter: VoiceAdapter = {
        init: vi.fn().mockImplementation(
          () =>
            new Promise<void>((resolve) => {
              resolveInit = resolve;
            })
        ),
        speak: vi.fn(),
        listen: vi.fn(),
        record: vi.fn(),
        cancel: vi.fn(),
      };
      const manager = new VoiceManager(slowAdapter);

      const staleInitPromise = manager.init();
      await Promise.resolve();
      expect(manager.getStatus()).toBe('initializing');

      const replacementAdapter: VoiceAdapter = {
        init: vi.fn().mockResolvedValue(undefined),
        speak: vi.fn(),
        listen: vi.fn(),
        record: vi.fn(),
        cancel: vi.fn(),
      };
      manager.setAdapter(replacementAdapter);
      expect(manager.getStatus()).toBe('idle');

      resolveInit();
      await staleInitPromise;

      expect(manager.getStatus()).toBe('idle');
      expect(replacementAdapter.init).not.toHaveBeenCalled();

      await manager.init();
      expect(replacementAdapter.init).toHaveBeenCalledTimes(1);
      expect(manager.getStatus()).toBe('ready');
    });
  });

  describe('init', () => {
    it('initializes adapter and sets status to ready', async () => {
      const manager = new VoiceManager(mockAdapter);

      await manager.init();

      expect(mockAdapter.init).toHaveBeenCalled();
      expect(manager.getStatus()).toBe('ready');
    });

    it('sets status to initializing during init', async () => {
      let statusDuringInit: string | undefined;
      const slowAdapter: VoiceAdapter = {
        init: vi.fn().mockImplementation(async () => {
          statusDuringInit = manager.getStatus();
          await new Promise((resolve) => setTimeout(resolve, 10));
        }),
        speak: vi.fn(),
        listen: vi.fn(),
        record: vi.fn(),
        cancel: vi.fn(),
      };

      const manager = new VoiceManager(slowAdapter);
      await manager.init();

      expect(statusDuringInit).toBe('initializing');
    });

    it('returns immediately if already ready', async () => {
      const manager = new VoiceManager(mockAdapter);

      await manager.init();
      await manager.init();

      expect(mockAdapter.init).toHaveBeenCalledTimes(1);
    });

    it('reuses existing init promise if already initializing', async () => {
      const manager = new VoiceManager(mockAdapter);

      const promise1 = manager.init();
      const promise2 = manager.init();

      await Promise.all([promise1, promise2]);

      expect(mockAdapter.init).toHaveBeenCalledTimes(1);
    });

    it('sets error status on init failure', async () => {
      const failingAdapter: VoiceAdapter = {
        init: vi.fn().mockRejectedValue(new Error('Init failed')),
        speak: vi.fn(),
        listen: vi.fn(),
        record: vi.fn(),
        cancel: vi.fn(),
      };

      const manager = new VoiceManager(failingAdapter);

      await expect((async () => manager.init())()).rejects.toThrow('Init failed');
      expect(manager.getStatus()).toBe('error');
    });

    it('normalizes non-Error thrown values', async () => {
      const failingAdapter: VoiceAdapter = {
        init: vi.fn().mockRejectedValue('string error'),
        speak: vi.fn(),
        listen: vi.fn(),
        record: vi.fn(),
        cancel: vi.fn(),
      };

      const manager = new VoiceManager(failingAdapter);

      await expect((async () => manager.init())()).rejects.toThrow('string error');
      expect(manager.getError()).toBeInstanceOf(Error);
    });

    it('loads adapter via factory when no adapter provided', async () => {
      const factoryAdapter: VoiceAdapter = {
        init: vi.fn().mockResolvedValue(undefined),
        speak: vi.fn(),
        listen: vi.fn(),
        record: vi.fn(),
        cancel: vi.fn(),
      };

      const factory = vi.fn().mockResolvedValue(factoryAdapter);
      const manager = new VoiceManager(undefined, mockLogger, factory);

      await manager.init();

      expect(factory).toHaveBeenCalled();
      expect(factoryAdapter.init).toHaveBeenCalled();
    });

    it('ignores stale init errors after adapter swap', async () => {
      let rejectInit: (error: unknown) => void = () => {};
      const failingAdapter: VoiceAdapter = {
        init: vi.fn().mockImplementation(
          () =>
            new Promise<void>((_, reject) => {
              rejectInit = reject;
            })
        ),
        speak: vi.fn(),
        listen: vi.fn(),
        record: vi.fn(),
        cancel: vi.fn(),
      };
      const manager = new VoiceManager(failingAdapter);
      const staleInitPromise = manager.init();
      await Promise.resolve();

      const replacementAdapter: VoiceAdapter = {
        init: vi.fn().mockResolvedValue(undefined),
        speak: vi.fn(),
        listen: vi.fn(),
        record: vi.fn(),
        cancel: vi.fn(),
      };
      manager.setAdapter(replacementAdapter);

      rejectInit(new Error('Init failed'));
      let staleInitError: Error | null = null;
      try {
        await staleInitPromise;
      } catch (error) {
        staleInitError = error instanceof Error ? error : new Error(String(error));
      }
      expect(staleInitError?.message).toBe('Init failed');

      expect(manager.getStatus()).toBe('idle');
      expect(manager.getError()).toBeNull();

      await manager.init();
      expect(replacementAdapter.init).toHaveBeenCalledTimes(1);
      expect(manager.getStatus()).toBe('ready');
    });

    it('does not initialize stale factory adapter after adapter swap', async () => {
      let resolveFactory: (adapter: VoiceAdapter) => void = () => {};
      const staleFactoryAdapter: VoiceAdapter = {
        init: vi.fn().mockResolvedValue(undefined),
        speak: vi.fn(),
        listen: vi.fn(),
        record: vi.fn(),
        cancel: vi.fn(),
      };
      const factory = vi.fn().mockImplementation(
        () =>
          new Promise<VoiceAdapter>((resolve) => {
            resolveFactory = resolve;
          })
      );

      const manager = new VoiceManager(undefined, mockLogger, factory);
      const staleInitPromise = manager.init();
      await Promise.resolve();

      const replacementAdapter: VoiceAdapter = {
        init: vi.fn().mockResolvedValue(undefined),
        speak: vi.fn(),
        listen: vi.fn(),
        record: vi.fn(),
        cancel: vi.fn(),
      };
      manager.setAdapter(replacementAdapter);

      resolveFactory(staleFactoryAdapter);
      await staleInitPromise;

      expect(staleFactoryAdapter.init).not.toHaveBeenCalled();
      expect(manager.getStatus()).toBe('idle');

      await manager.init();
      expect(replacementAdapter.init).toHaveBeenCalledTimes(1);
      expect(manager.getStatus()).toBe('ready');
    });
  });

  describe('speak', () => {
    it('speaks text after initialization', async () => {
      const manager = new VoiceManager(mockAdapter);
      await manager.init();

      await manager.speak('Hello world');

      expect(mockAdapter.speak).toHaveBeenCalledWith('Hello world');
    });

    it('auto-initializes if not ready', async () => {
      const manager = new VoiceManager(mockAdapter);

      await manager.speak('Hello');

      expect(mockAdapter.init).toHaveBeenCalled();
      expect(mockAdapter.speak).toHaveBeenCalledWith('Hello');
    });

    it('sets error status on speak failure', async () => {
      const failingAdapter: VoiceAdapter = {
        init: vi.fn().mockResolvedValue(undefined),
        speak: vi.fn().mockRejectedValue(new Error('Speak failed')),
        listen: vi.fn(),
        record: vi.fn(),
        cancel: vi.fn(),
      };

      const manager = new VoiceManager(failingAdapter);
      await manager.init();

      await expect((async () => manager.speak('Hello'))()).rejects.toThrow('Speak failed');
      expect(manager.getStatus()).toBe('error');
      expect(manager.getError()?.message).toBe('Speak failed');
    });

    it('does not set error status on cancelled speak', async () => {
      const cancellingAdapter: VoiceAdapter = {
        init: vi.fn().mockResolvedValue(undefined),
        speak: vi.fn().mockRejectedValue(new Error('Voice input cancelled.')),
        listen: vi.fn(),
        record: vi.fn(),
        cancel: vi.fn(),
      };

      const manager = new VoiceManager(cancellingAdapter);
      await manager.init();

      await expect((async () => manager.speak('Hello'))()).rejects.toThrow(
        'Voice input cancelled.'
      );
      expect(manager.getStatus()).toBe('ready');
      expect(manager.getError()).toBeNull();
    });

    it('ignores stale speak errors after adapter swap', async () => {
      let rejectSpeak: (error: unknown) => void = () => {};
      const staleAdapter: VoiceAdapter = {
        init: vi.fn().mockResolvedValue(undefined),
        speak: vi.fn().mockImplementation(
          () =>
            new Promise<void>((_, reject) => {
              rejectSpeak = reject;
            })
        ),
        listen: vi.fn(),
        record: vi.fn(),
        cancel: vi.fn(),
      };
      const replacementAdapter: VoiceAdapter = {
        init: vi.fn().mockResolvedValue(undefined),
        speak: vi.fn(),
        listen: vi.fn(),
        record: vi.fn(),
        cancel: vi.fn(),
      };

      const manager = new VoiceManager(staleAdapter);
      await manager.init();

      const staleSpeakPromise = manager.speak('Hello');
      await Promise.resolve();

      manager.setAdapter(replacementAdapter);
      rejectSpeak(new Error('Stale speak failed'));

      await expect(staleSpeakPromise).rejects.toThrow('Stale speak failed');
      expect(manager.getStatus()).toBe('idle');
      expect(manager.getError()).toBeNull();
    });
  });

  describe('listen', () => {
    it('listens and returns transcript', async () => {
      const manager = new VoiceManager(mockAdapter);
      await manager.init();

      const result = await manager.listen();

      expect(result).toBe('test transcript');
      expect(mockAdapter.listen).toHaveBeenCalled();
    });

    it('auto-initializes if not ready', async () => {
      const manager = new VoiceManager(mockAdapter);

      await manager.listen();

      expect(mockAdapter.init).toHaveBeenCalled();
      expect(mockAdapter.listen).toHaveBeenCalled();
    });

    it('sets error status on listen failure', async () => {
      const failingAdapter: VoiceAdapter = {
        init: vi.fn().mockResolvedValue(undefined),
        speak: vi.fn(),
        listen: vi.fn().mockRejectedValue(new Error('Listen failed')),
        record: vi.fn(),
        cancel: vi.fn(),
      };

      const manager = new VoiceManager(failingAdapter);
      await manager.init();

      await expect((async () => manager.listen())()).rejects.toThrow('Listen failed');
      expect(manager.getStatus()).toBe('error');
    });

    it('does not set error status on cancelled listen', async () => {
      const cancellingAdapter: VoiceAdapter = {
        init: vi.fn().mockResolvedValue(undefined),
        speak: vi.fn(),
        listen: vi.fn().mockRejectedValue(new Error('Voice input cancelled.')),
        record: vi.fn(),
        cancel: vi.fn(),
      };

      const manager = new VoiceManager(cancellingAdapter);
      await manager.init();

      await expect((async () => manager.listen())()).rejects.toThrow('Voice input cancelled.');
      expect(manager.getStatus()).toBe('ready');
      expect(manager.getError()).toBeNull();
    });

    it('normalizes non-Error thrown values in listen', async () => {
      const failingAdapter: VoiceAdapter = {
        init: vi.fn().mockResolvedValue(undefined),
        speak: vi.fn(),
        listen: vi.fn().mockRejectedValue('string error'),
        record: vi.fn(),
        cancel: vi.fn(),
      };

      const manager = new VoiceManager(failingAdapter);
      await manager.init();

      await expect((async () => manager.listen())()).rejects.toThrow('string error');
      expect(manager.getError()).toBeInstanceOf(Error);
    });
  });

  describe('record', () => {
    it('records audio after initialization', async () => {
      const manager = new VoiceManager(mockAdapter);
      await manager.init();

      const result = await manager.record();

      expect(result).toEqual({ data: 'b64', format: 'wav' });
      expect(mockAdapter.record).toHaveBeenCalled();
    });

    it('auto-initializes if not ready', async () => {
      const manager = new VoiceManager(mockAdapter);

      await manager.record();

      expect(mockAdapter.init).toHaveBeenCalled();
      expect(mockAdapter.record).toHaveBeenCalled();
    });

    it('sets error status on record failure', async () => {
      const failingAdapter: VoiceAdapter = {
        init: vi.fn().mockResolvedValue(undefined),
        speak: vi.fn(),
        listen: vi.fn(),
        record: vi.fn().mockRejectedValue(new Error('Record failed')),
        cancel: vi.fn(),
      };

      const manager = new VoiceManager(failingAdapter);
      await manager.init();

      await expect((async () => manager.record())()).rejects.toThrow('Record failed');
      expect(manager.getStatus()).toBe('error');
      expect(manager.getError()?.message).toBe('Record failed');
    });

    it('does not set error status on cancelled record', async () => {
      const cancellingAdapter: VoiceAdapter = {
        init: vi.fn().mockResolvedValue(undefined),
        speak: vi.fn(),
        listen: vi.fn(),
        record: vi.fn().mockRejectedValue(new Error('Voice input cancelled.')),
        cancel: vi.fn(),
      };

      const manager = new VoiceManager(cancellingAdapter);
      await manager.init();

      await expect((async () => manager.record())()).rejects.toThrow('Voice input cancelled.');
      expect(manager.getStatus()).toBe('ready');
      expect(manager.getError()).toBeNull();
    });

    it('normalizes non-Error thrown values in record', async () => {
      const failingAdapter: VoiceAdapter = {
        init: vi.fn().mockResolvedValue(undefined),
        speak: vi.fn(),
        listen: vi.fn(),
        record: vi.fn().mockRejectedValue('string error'),
        cancel: vi.fn(),
      };

      const manager = new VoiceManager(failingAdapter);
      await manager.init();

      await expect((async () => manager.record())()).rejects.toThrow('string error');
      expect(manager.getError()).toBeInstanceOf(Error);
    });

    it('ignores stale record errors after adapter swap', async () => {
      let rejectRecord: (error: unknown) => void = () => {};
      const staleAdapter: VoiceAdapter = {
        init: vi.fn().mockResolvedValue(undefined),
        speak: vi.fn(),
        listen: vi.fn(),
        record: vi.fn().mockImplementation(
          () =>
            new Promise<{ data: string; format: string }>((_, reject) => {
              rejectRecord = reject;
            })
        ),
        cancel: vi.fn(),
      };
      const replacementAdapter: VoiceAdapter = {
        init: vi.fn().mockResolvedValue(undefined),
        speak: vi.fn(),
        listen: vi.fn(),
        record: vi.fn(),
        cancel: vi.fn(),
      };

      const manager = new VoiceManager(staleAdapter);
      await manager.init();

      const staleRecordPromise = manager.record();
      await Promise.resolve();

      manager.setAdapter(replacementAdapter);
      rejectRecord(new Error('Stale record failed'));

      await expect(staleRecordPromise).rejects.toThrow('Stale record failed');
      expect(manager.getStatus()).toBe('idle');
      expect(manager.getError()).toBeNull();
    });
  });

  describe('cancel', () => {
    it('cancels current operation', async () => {
      const manager = new VoiceManager(mockAdapter);
      await manager.init();

      await manager.cancel();

      expect(mockAdapter.cancel).toHaveBeenCalled();
    });

    it('does nothing if no adapter', async () => {
      const manager = new VoiceManager();

      expect(await manager.cancel()).toBeUndefined();
    });

    it('sets error status on cancel failure', async () => {
      const failingAdapter: VoiceAdapter = {
        init: vi.fn().mockResolvedValue(undefined),
        speak: vi.fn(),
        listen: vi.fn(),
        record: vi.fn(),
        cancel: vi.fn().mockRejectedValue(new Error('Cancel failed')),
      };

      const manager = new VoiceManager(failingAdapter, mockLogger);
      await manager.init();

      await expect((async () => manager.cancel())()).rejects.toThrow('Cancel failed');
      expect(manager.getStatus()).toBe('error');
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('normalizes non-Error thrown values in cancel', async () => {
      const failingAdapter: VoiceAdapter = {
        init: vi.fn().mockResolvedValue(undefined),
        speak: vi.fn(),
        listen: vi.fn(),
        record: vi.fn(),
        cancel: vi.fn().mockRejectedValue('string error'),
      };

      const manager = new VoiceManager(failingAdapter, mockLogger);
      await manager.init();

      await expect((async () => manager.cancel())()).rejects.toThrow('string error');
      expect(manager.getError()).toBeInstanceOf(Error);
    });

    it('ignores stale cancel errors after adapter swap', async () => {
      let rejectCancel: (error: unknown) => void = () => {};
      const staleAdapter: VoiceAdapter = {
        init: vi.fn().mockResolvedValue(undefined),
        speak: vi.fn(),
        listen: vi.fn(),
        record: vi.fn(),
        cancel: vi.fn().mockImplementation(
          () =>
            new Promise<void>((_, reject) => {
              rejectCancel = reject;
            })
        ),
      };
      const replacementAdapter: VoiceAdapter = {
        init: vi.fn().mockResolvedValue(undefined),
        speak: vi.fn(),
        listen: vi.fn(),
        record: vi.fn(),
        cancel: vi.fn(),
      };

      const manager = new VoiceManager(staleAdapter, mockLogger);
      await manager.init();

      const staleCancelPromise = manager.cancel();
      await Promise.resolve();

      manager.setAdapter(replacementAdapter);
      rejectCancel(new Error('Stale cancel failed'));

      await expect(staleCancelPromise).rejects.toThrow('Stale cancel failed');
      expect(manager.getStatus()).toBe('idle');
      expect(manager.getError()).toBeNull();
    });
  });

  describe('ensureReady', () => {
    it('throws initialization error when init fails and status is not ready', async () => {
      const failingAdapter: VoiceAdapter = {
        init: vi.fn().mockRejectedValue(new Error('Init failed')),
        speak: vi.fn(),
        listen: vi.fn(),
        record: vi.fn(),
        cancel: vi.fn(),
      };

      const manager = new VoiceManager(failingAdapter);

      await expect((async () => manager.speak('Hello'))()).rejects.toThrow('Init failed');
    });

    it('throws generic error when no error is set but status is not ready', async () => {
      // Create a manager with a factory that fails to provide an adapter
      const failingFactory = vi.fn().mockImplementation(async () => {
        throw new Error('Factory failed');
      });

      const manager = new VoiceManager(undefined, mockLogger, failingFactory);

      await expect((async () => manager.speak('Hello'))()).rejects.toThrow('Factory failed');
    });
  });

  describe('defaultAdapterFactory', () => {
    it('fails to init in test environment without proper platform setup', async () => {
      // In test environment, the default factory is used
      // which attempts to load a platform-specific adapter
      const manager = new VoiceManager();

      // This will fail because test env doesn't have proper platform setup
      await expect((async () => manager.init())()).rejects.toThrow();
    });

    it('custom factory can override platform detection', async () => {
      const customAdapter: VoiceAdapter = {
        init: vi.fn().mockResolvedValue(undefined),
        speak: vi.fn(),
        listen: vi.fn(),
        record: vi.fn(),
        cancel: vi.fn(),
      };

      const customFactory = vi.fn().mockResolvedValue(customAdapter);
      const manager = new VoiceManager(undefined, mockLogger, customFactory);

      await manager.init();

      expect(customFactory).toHaveBeenCalled();
      expect(customAdapter.init).toHaveBeenCalled();
    });
  });

  describe('state notification', () => {
    it('does not notify when status and error are unchanged', async () => {
      const manager = new VoiceManager(mockAdapter);
      const listener = vi.fn();

      await manager.init();
      listener.mockClear();

      manager.subscribe(listener);

      // Re-initializing when already ready should not notify
      await manager.init();

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('defaultAdapterFactory platform handling', () => {
    it('calls factory with detected platform', async () => {
      const factoryAdapter: VoiceAdapter = {
        init: vi.fn().mockResolvedValue(undefined),
        speak: vi.fn(),
        listen: vi.fn(),
        record: vi.fn(),
        cancel: vi.fn(),
      };

      const unknownFactory = vi.fn().mockResolvedValue(factoryAdapter);

      const manager = new VoiceManager(undefined, mockLogger, unknownFactory);

      await manager.init();

      // Factory should be called with the detected platform (mocked as 'web')
      expect(unknownFactory).toHaveBeenCalledWith('web');
      expect(factoryAdapter.init).toHaveBeenCalled();
    });
  });
});
