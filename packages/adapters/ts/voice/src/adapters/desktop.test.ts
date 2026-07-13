import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import { DesktopVoiceAdapter } from './desktop';

describe('voice/adapters/desktop', () => {
  const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalMediaRecorderDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'MediaRecorder'
  );
  const originalFileReaderDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'FileReader');
  const originalWindow = globalThis.window;
  let mockInvoke: ReturnType<typeof vi.fn>;

  const setWindow = (value: unknown) => {
    Object.defineProperty(globalThis, 'window', {
      value,
      writable: true,
      configurable: true,
    });
  };

  const restoreWindow = () => {
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
      return;
    }
    if (originalWindow !== undefined) {
      setWindow(originalWindow);
      return;
    }
    Reflect.deleteProperty(globalThis, 'window');
  };

  const setGlobal = (name: string, value: unknown) => {
    Object.defineProperty(globalThis, name, {
      value,
      writable: true,
      configurable: true,
    });
  };

  const restoreGlobal = (name: string, descriptor: PropertyDescriptor | undefined) => {
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
      return;
    }
    Reflect.deleteProperty(globalThis, name);
  };

  const setupMediaRecorder = () => {
    const stopTrack = vi.fn();
    const mockRecorder = {
      ondataavailable: null as ((event: { data: Blob }) => void) | null,
      onstop: null as (() => void) | null,
      start: vi.fn(() => {
        mockRecorder.state = 'recording';
      }),
      stop: vi.fn(() => {
        mockRecorder.state = 'inactive';
        mockRecorder.ondataavailable?.({
          data: new Blob(['audio-data'], { type: 'audio/webm' }),
        });
        mockRecorder.onstop?.();
      }),
      state: 'inactive',
      mimeType: 'audio/webm',
    };

    setGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [{ stop: stopTrack }],
        })),
      },
    });
    setGlobal(
      'MediaRecorder',
      vi.fn(() => mockRecorder)
    );
    setGlobal(
      'FileReader',
      class {
        result: string | null = null;
        error: DOMException | null = null;
        private listeners: Record<string, Array<() => void>> = {};

        addEventListener(event: string, listener: () => void) {
          this.listeners[event] = [...(this.listeners[event] ?? []), listener];
        }

        readAsDataURL(_blob: Blob) {
          this.result = 'data:audio/webm;base64,ZGVza3RvcA==';
          setTimeout(() => {
            for (const listener of this.listeners['load'] ?? []) listener();
            for (const listener of this.listeners['loadend'] ?? []) listener();
          }, 0);
        }
      }
    );

    return { mockRecorder, stopTrack };
  };

  beforeEach(() => {
    mockInvoke = vi.fn().mockResolvedValue(undefined);
    setWindow({
      __TAURI__: {
        invoke: mockInvoke,
      },
    });
  });

  afterEach(() => {
    restoreWindow();
    restoreGlobal('navigator', originalNavigatorDescriptor);
    restoreGlobal('MediaRecorder', originalMediaRecorderDescriptor);
    restoreGlobal('FileReader', originalFileReaderDescriptor);
    vi.restoreAllMocks();
  });

  describe('DesktopVoiceAdapter', () => {
    it('creates instance', () => {
      const adapter = new DesktopVoiceAdapter();
      expect(adapter).toBeInstanceOf(DesktopVoiceAdapter);
    });

    describe('init', () => {
      it('initializes successfully when Tauri bridge available', async () => {
        const adapter = new DesktopVoiceAdapter();

        expect(await adapter.init()).toBeUndefined();
      });

      it('throws error when Tauri bridge not available', async () => {
        setWindow({});

        const adapter = new DesktopVoiceAdapter();

        await expect((async () => adapter.init())()).rejects.toThrow(
          'Tauri voice bridge is not available.'
        );
      });

      it('throws error when window is missing', async () => {
        Reflect.deleteProperty(globalThis, 'window');

        const adapter = new DesktopVoiceAdapter();

        await expect((async () => adapter.init())()).rejects.toThrow(
          'Tauri voice bridge is not available.'
        );
      });

      it('throws error when __TAURI__.invoke is missing', async () => {
        setWindow({
          __TAURI__: {},
        });

        const adapter = new DesktopVoiceAdapter();

        await expect((async () => adapter.init())()).rejects.toThrow(
          'Tauri voice bridge is not available.'
        );
      });

      it('returns immediately if already initialized', async () => {
        const adapter = new DesktopVoiceAdapter();

        await adapter.init();
        await adapter.init();

        // Should not throw, just return
        expect(true).toBe(true);
      });

      it('reuses existing init promise if init in progress', async () => {
        let resolveInit: () => void = () => {};
        mockInvoke.mockImplementation(
          () =>
            new Promise<void>((resolve) => {
              resolveInit = resolve;
            })
        );

        const adapter = new DesktopVoiceAdapter();

        const promise1 = adapter.init();
        const promise2 = adapter.init();

        resolveInit();

        await Promise.all([promise1, promise2]);

        // Both should resolve to the same promise
        expect(true).toBe(true);
      });

      it('resets initialization state on error', async () => {
        setWindow({});

        const adapter = new DesktopVoiceAdapter();

        await expect((async () => adapter.init())()).rejects.toThrow();

        // Restore Tauri bridge
        setWindow({
          __TAURI__: {
            invoke: mockInvoke,
          },
        });

        // Should be able to init again
        expect(await adapter.init()).toBeUndefined();
      });
    });

    describe('speak', () => {
      it('invokes voice_speak command with text', async () => {
        const adapter = new DesktopVoiceAdapter();
        await adapter.init();

        await adapter.speak('Hello world');

        expect(mockInvoke).toHaveBeenCalledWith('voice_speak', { text: 'Hello world' });
      });

      it('auto-initializes if not initialized', async () => {
        const adapter = new DesktopVoiceAdapter();

        await adapter.speak('Hello');

        expect(mockInvoke).toHaveBeenCalledWith('voice_speak', { text: 'Hello' });
      });

      it('throws error if Tauri bridge becomes unavailable', async () => {
        const adapter = new DesktopVoiceAdapter();
        await adapter.init();

        // Remove Tauri bridge
        // @ts-expect-error - setting globals for test
        globalThis.window = {};

        await expect((async () => adapter.speak('Hello'))()).rejects.toThrow(
          'Tauri voice bridge is not available.'
        );
      });
    });

    describe('listen', () => {
      it('invokes voice_listen command and returns transcript', async () => {
        mockInvoke.mockResolvedValue('transcribed text');

        const adapter = new DesktopVoiceAdapter();
        await adapter.init();

        const result = await adapter.listen();

        expect(mockInvoke).toHaveBeenCalledWith('voice_listen', undefined);
        expect(result).toBe('transcribed text');
      });

      it('throws error if response is not a string', async () => {
        mockInvoke.mockResolvedValue({ invalid: 'response' });

        const adapter = new DesktopVoiceAdapter();
        await adapter.init();

        await expect((async () => adapter.listen())()).rejects.toThrow(
          'Tauri voice bridge returned invalid response.'
        );
      });

      it('throws error if response is null', async () => {
        mockInvoke.mockResolvedValue(null);

        const adapter = new DesktopVoiceAdapter();
        await adapter.init();

        await expect((async () => adapter.listen())()).rejects.toThrow(
          'Tauri voice bridge returned invalid response.'
        );
      });

      it('throws error if response is undefined', async () => {
        mockInvoke.mockResolvedValue(undefined);

        const adapter = new DesktopVoiceAdapter();
        await adapter.init();

        await expect((async () => adapter.listen())()).rejects.toThrow(
          'Tauri voice bridge returned invalid response.'
        );
      });

      it('throws error if response is a number', async () => {
        mockInvoke.mockResolvedValue(123);

        const adapter = new DesktopVoiceAdapter();
        await adapter.init();

        await expect((async () => adapter.listen())()).rejects.toThrow(
          'Tauri voice bridge returned invalid response.'
        );
      });

      it('clears active listen state when native listen fails', async () => {
        mockInvoke.mockRejectedValueOnce(new Error('Listen failed'));

        const adapter = new DesktopVoiceAdapter();
        await adapter.init();

        await expect((async () => adapter.listen())()).rejects.toThrow('Listen failed');
        mockInvoke.mockClear();

        await adapter.finishListening();

        expect(mockInvoke).not.toHaveBeenCalledWith('voice_cancel', undefined);
      });
    });

    describe('record', () => {
      it('records microphone audio with MediaRecorder', async () => {
        const { mockRecorder, stopTrack } = setupMediaRecorder();
        const adapter = new DesktopVoiceAdapter();

        const recordPromise = adapter.record();
        await Promise.resolve();
        await adapter.finishListening();

        await expect(recordPromise).resolves.toEqual({ data: 'ZGVza3RvcA==', format: 'webm' });
        expect(mockRecorder.stop).toHaveBeenCalledTimes(1);
        expect(stopTrack).toHaveBeenCalledTimes(1);
      });

      it('cancels active recording without invoking native speech cancellation', async () => {
        const { mockRecorder } = setupMediaRecorder();
        const adapter = new DesktopVoiceAdapter();

        const recordPromise = adapter.record();
        const recordOutcome = recordPromise.catch((error) => error);
        await Promise.resolve();
        await adapter.cancel();

        const error = await recordOutcome;
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe('Voice input cancelled.');
        expect(mockRecorder.stop).toHaveBeenCalledTimes(1);
        expect(mockInvoke).not.toHaveBeenCalledWith('voice_cancel', undefined);
      });
    });

    describe('cancel', () => {
      it('invokes voice_cancel command', async () => {
        const adapter = new DesktopVoiceAdapter();
        await adapter.init();

        await adapter.cancel();

        expect(mockInvoke).toHaveBeenCalledWith('voice_cancel', undefined);
      });

      it('does nothing when no native bridge has been initialized', async () => {
        const adapter = new DesktopVoiceAdapter();

        await adapter.cancel();

        expect(mockInvoke).not.toHaveBeenCalled();
      });

      it('does not throw if the native bridge disappears before cancel', async () => {
        const adapter = new DesktopVoiceAdapter();
        await adapter.init();
        setWindow({});

        await expect(adapter.cancel()).resolves.toBeUndefined();
      });
    });

    describe('finishListening', () => {
      it('cancels an active native listen session', async () => {
        let resolveListen: (value: string) => void = () => {};
        mockInvoke.mockImplementation((command: string) => {
          if (command === 'voice_listen') {
            return new Promise<string>((resolve) => {
              resolveListen = resolve;
            });
          }
          return Promise.resolve(undefined);
        });

        const adapter = new DesktopVoiceAdapter();
        await adapter.init();
        const listenPromise = adapter.listen();
        await Promise.resolve();
        await Promise.resolve();

        await adapter.finishListening();
        resolveListen('finished transcript');

        await expect(listenPromise).resolves.toBe('finished transcript');
        expect(mockInvoke).toHaveBeenCalledWith('voice_cancel', undefined);
      });
    });
  });
});
