import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import { WebVoiceAdapter } from './web';

describe('voice/adapters/web', () => {
  const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalUtteranceDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'SpeechSynthesisUtterance'
  );
  const originalWindow = globalThis.window;
  const originalNavigator = globalThis.navigator;

  const setGlobal = (key: string, value: unknown) => {
    Object.defineProperty(globalThis, key, {
      value,
      writable: true,
      configurable: true,
    });
  };

  const restoreGlobal = (
    key: string,
    descriptor: PropertyDescriptor | undefined,
    fallback: unknown
  ) => {
    if (descriptor) {
      Object.defineProperty(globalThis, key, descriptor);
      return;
    }
    if (fallback !== undefined) {
      setGlobal(key, fallback);
      return;
    }
    Reflect.deleteProperty(globalThis, key);
  };

  type RecognitionListener = (...args: unknown[]) => void;
  type UtteranceListener = (event?: { error?: string }) => void;
  type MockRecognitionInstance = {
    interimResults: boolean;
    maxAlternatives: number;
    lang: string;
    addEventListener: ReturnType<
      typeof vi.fn<(event: string, listener: RecognitionListener) => void>
    >;
    start: ReturnType<typeof vi.fn<() => void>>;
    stop: ReturnType<typeof vi.fn<() => void>>;
  };

  let mockSpeechRecognition: ReturnType<typeof vi.fn>;
  let mockSpeechSynthesis: {
    speak: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
  };
  let mockGetUserMedia: ReturnType<typeof vi.fn>;
  let mockRecognitionInstance: MockRecognitionInstance;

  beforeEach(() => {
    const addEventListener = vi.fn<(event: string, listener: RecognitionListener) => void>();
    const start = vi.fn<() => void>();
    const stop = vi.fn<() => void>();

    mockRecognitionInstance = {
      interimResults: false,
      maxAlternatives: 1,
      lang: 'en-US',
      addEventListener,
      start,
      stop,
    };

    mockSpeechRecognition = vi.fn<() => typeof mockRecognitionInstance>(
      () => mockRecognitionInstance
    );

    mockSpeechSynthesis = {
      speak: vi.fn(),
      cancel: vi.fn(),
    };

    mockGetUserMedia = vi
      .fn<() => Promise<{ getTracks: () => Array<{ stop: () => void }> }>>()
      .mockResolvedValue({
        getTracks: () => [{ stop: vi.fn() }],
      });

    setGlobal('window', {
      SpeechRecognition: mockSpeechRecognition,
      speechSynthesis: mockSpeechSynthesis,
    });

    setGlobal('navigator', {
      language: 'en-US',
      mediaDevices: {
        getUserMedia: mockGetUserMedia,
      },
    });

    setGlobal(
      'SpeechSynthesisUtterance',
      class {
        text: string;
        listeners: Record<string, UtteranceListener[]> = {};

        constructor(text: string) {
          this.text = text;
        }

        addEventListener(event: string, listener: UtteranceListener) {
          if (!this.listeners[event]) this.listeners[event] = [];
          this.listeners[event].push(listener);
        }
      }
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    restoreGlobal('window', originalWindowDescriptor, originalWindow);
    restoreGlobal('navigator', originalNavigatorDescriptor, originalNavigator);
    restoreGlobal('SpeechSynthesisUtterance', originalUtteranceDescriptor, undefined);
    vi.restoreAllMocks();
  });

  describe('WebVoiceAdapter', () => {
    const installUtteranceTrigger = (trigger: 'end' | 'error', error?: string) => {
      setGlobal(
        'SpeechSynthesisUtterance',
        class {
          text: string;
          listeners: Record<string, UtteranceListener[]> = {};

          constructor(text: string) {
            this.text = text;
          }

          addEventListener(event: string, listener: UtteranceListener) {
            if (!this.listeners[event]) this.listeners[event] = [];
            this.listeners[event].push(listener);
            if (event === trigger) {
              setTimeout(() => listener(trigger === 'error' ? { error } : undefined), 0);
            }
          }
        }
      );
    };

    it('creates instance', () => {
      const adapter = new WebVoiceAdapter();
      expect(adapter).toBeInstanceOf(WebVoiceAdapter);
    });

    describe('init', () => {
      it('initializes with native, webkit, and optional microphone APIs', async () => {
        expect(await new WebVoiceAdapter().init()).toBeUndefined();
        setGlobal('window', {
          webkitSpeechRecognition: mockSpeechRecognition,
          speechSynthesis: mockSpeechSynthesis,
        });
        expect(await new WebVoiceAdapter().init()).toBeUndefined();
        setGlobal('navigator', { language: 'en-US', mediaDevices: undefined });
        expect(await new WebVoiceAdapter().init()).toBeUndefined();
      });

      it('rejects missing window and microphone permission failures', async () => {
        Reflect.deleteProperty(globalThis, 'window');
        await expect(new WebVoiceAdapter().init()).rejects.toThrow('Window missing');

        setGlobal('window', {
          SpeechRecognition: mockSpeechRecognition,
          speechSynthesis: mockSpeechSynthesis,
        });
        for (const name of ['NotAllowedError', 'PermissionDeniedError']) {
          const permissionError = new Error('Permission denied');
          permissionError.name = name;
          mockGetUserMedia.mockRejectedValueOnce(permissionError);
          await expect(new WebVoiceAdapter().init()).rejects.toThrow(
            'Microphone permission denied.'
          );
        }
        const otherError = new Error('Some other error');
        otherError.name = 'SomeOtherError';
        mockGetUserMedia.mockRejectedValueOnce(otherError);
        expect(await new WebVoiceAdapter().init()).toBeUndefined();
      });

      it('does not require speech APIs for basic initialization', async () => {
        setGlobal('window', {});

        await expect(new WebVoiceAdapter().init()).resolves.toBeUndefined();
      });
    });

    describe('speak', () => {
      it('speaks text using speech synthesis', async () => {
        const adapter = new WebVoiceAdapter();
        await adapter.init();
        installUtteranceTrigger('end');
        await adapter.speak('Hello');

        expect(mockSpeechSynthesis.cancel).toHaveBeenCalled();
        expect(mockSpeechSynthesis.speak).toHaveBeenCalled();
      });

      it('auto-initializes if not initialized', async () => {
        const adapter = new WebVoiceAdapter();
        installUtteranceTrigger('end');
        await adapter.speak('Hello');

        expect(mockSpeechSynthesis.speak).toHaveBeenCalled();
      });

      it('rejects with explicit and default speech errors', async () => {
        const adapter = new WebVoiceAdapter();
        await adapter.init();
        installUtteranceTrigger('error', 'synthesis-error');
        await expect(adapter.speak('Hello')).rejects.toThrow('synthesis-error');
        installUtteranceTrigger('error');
        await expect(adapter.speak('Hello')).rejects.toThrow('Speak failed');
      });

      it('maps browser speech cancellation errors to voice cancellation', async () => {
        const adapter = new WebVoiceAdapter();
        await adapter.init();

        for (const error of ['canceled', 'interrupted'] as const) {
          installUtteranceTrigger('error', error);
          await expect(adapter.speak('Hello')).rejects.toThrow('Voice input cancelled.');
        }
      });

      it('rejects when speech synthesis is unsupported', async () => {
        setGlobal('window', {
          SpeechRecognition: mockSpeechRecognition,
        });

        await expect(new WebVoiceAdapter().speak('Hello')).rejects.toThrow(
          'Speech API unsupported'
        );
      });
    });

    describe('listen', () => {
      it('listens and returns transcript', async () => {
        const adapter = new WebVoiceAdapter();
        await adapter.init();

        mockRecognitionInstance.addEventListener.mockImplementation(
          (event: string, listener: RecognitionListener) => {
            if (event === 'result') {
              setTimeout(() => {
                listener({
                  results: [[{ transcript: 'Hello world' }]],
                });
              }, 0);
            }
          }
        );

        const result = await adapter.listen();

        expect(result).toBe('Hello world');
        expect(mockRecognitionInstance.start).toHaveBeenCalled();
      });

      it('auto-initializes if not initialized', async () => {
        const adapter = new WebVoiceAdapter();

        mockRecognitionInstance.addEventListener.mockImplementation(
          (event: string, listener: RecognitionListener) => {
            if (event === 'result') {
              setTimeout(() => {
                listener({
                  results: [[{ transcript: 'test' }]],
                });
              }, 0);
            }
          }
        );

        await adapter.listen();

        expect(mockRecognitionInstance.start).toHaveBeenCalled();
      });

      it('rejects when speech recognition is unavailable', async () => {
        setGlobal('window', {
          speechSynthesis: mockSpeechSynthesis,
        });

        await expect(new WebVoiceAdapter().listen()).rejects.toThrow(
          'Speech recognition is not available in this browser.'
        );
      });

      it('cancels previous listen session', async () => {
        const adapter = new WebVoiceAdapter();
        await adapter.init();

        let firstListenResult: RecognitionListener | null = null;
        mockRecognitionInstance.addEventListener.mockImplementation(
          (event: string, listener: RecognitionListener) => {
            if (event === 'result') {
              firstListenResult = listener;
            }
          }
        );

        const firstPromise = adapter.listen();

        mockRecognitionInstance.addEventListener.mockImplementation(
          (event: string, listener: RecognitionListener) => {
            if (event === 'result') {
              setTimeout(() => {
                listener({
                  results: [[{ transcript: 'second' }]],
                });
              }, 0);
            }
          }
        );

        if (firstListenResult !== null) {
          (firstListenResult as RecognitionListener)({
            results: [[{ transcript: 'first' }]],
          });
        }

        await firstPromise;
        const result = await adapter.listen();

        expect(result).toBe('second');
      });

      it('returns empty string for result payloads without transcript', async () => {
        const adapter = new WebVoiceAdapter();
        await adapter.init();

        for (const results of [[[{}]], []]) {
          mockRecognitionInstance.addEventListener.mockImplementationOnce(
            (event: string, listener: RecognitionListener) => {
              if (event === 'result') {
                setTimeout(() => listener({ results }), 0);
              }
            }
          );
          expect(await adapter.listen()).toBe('');
        }
      });

      for (const { code, message } of [
        { code: 'not-allowed', message: 'Microphone permission denied.' },
        { code: 'service-not-allowed', message: 'Speech service not allowed.' },
        { code: 'no-speech', message: 'No speech detected.' },
        { code: 'audio-capture', message: 'Audio capture failed.' },
        { code: 'network', message: 'Network error.' },
        { code: 'language-not-supported', message: 'Language not supported.' },
        { code: 'aborted', message: 'Voice input cancelled.' },
        { code: 'unknown-error', message: 'Error: unknown-error' },
      ]) {
        it(`handles ${code} error`, async () => {
          const adapter = new WebVoiceAdapter();
          await adapter.init();

          mockRecognitionInstance.addEventListener.mockImplementation(
            (event: string, listener: RecognitionListener) => {
              if (event === 'error') {
                setTimeout(() => {
                  listener({ error: code });
                }, 0);
              }
            }
          );

          await expect((async () => adapter.listen())()).rejects.toThrow(message);
        });
      }

      it('returns empty string on end event without result', async () => {
        const adapter = new WebVoiceAdapter();
        await adapter.init();

        mockRecognitionInstance.addEventListener.mockImplementation(
          (event: string, listener: RecognitionListener) => {
            if (event === 'end') {
              setTimeout(() => listener(), 0);
            }
          }
        );

        const result = await adapter.listen();

        expect(result).toBe('');
      });

      it('rejects with cancelled error when listen is cancelled', async () => {
        const adapter = new WebVoiceAdapter();
        await adapter.init();

        const listeners = new Map<string, RecognitionListener>();
        mockRecognitionInstance.addEventListener.mockImplementation(
          (event: string, listener: RecognitionListener) => {
            listeners.set(event, listener);
          }
        );
        mockRecognitionInstance.stop.mockImplementation(() => {
          listeners.get('end')?.();
        });

        const listenPromise = adapter.listen();
        await adapter.cancel();

        await expect(listenPromise).rejects.toThrow('Voice input cancelled.');
      });

      it('does not let stale listen end events clear a newer session', async () => {
        const adapter = new WebVoiceAdapter();
        await adapter.init();

        const createRecognition = () => {
          const listeners = new Map<string, RecognitionListener>();
          const recognition: MockRecognitionInstance = {
            interimResults: false,
            maxAlternatives: 1,
            lang: 'en-US',
            addEventListener: vi.fn((event: string, listener: RecognitionListener) => {
              listeners.set(event, listener);
            }),
            start: vi.fn(),
            stop: vi.fn(),
          };
          return { listeners, recognition };
        };

        const first = createRecognition();
        const second = createRecognition();
        mockSpeechRecognition
          .mockImplementationOnce(() => first.recognition)
          .mockImplementationOnce(() => second.recognition);

        const firstPromise = adapter.listen();
        const firstOutcome = firstPromise.catch((error) => error);
        await adapter.cancel();

        const secondPromise = adapter.listen();
        first.listeners.get('end')?.();
        await adapter.cancel();
        second.listeners.get('end')?.();

        const firstError = await firstOutcome;
        expect(firstError).toBeInstanceOf(Error);
        expect((firstError as Error).message).toBe('Voice input cancelled.');
        await expect(secondPromise).rejects.toThrow('Voice input cancelled.');
        expect(second.recognition.stop).toHaveBeenCalledTimes(1);
      });

      it('handles start() throwing error', async () => {
        const adapter = new WebVoiceAdapter();
        await adapter.init();

        mockRecognitionInstance.start.mockImplementation(() => {
          throw new Error('Start failed');
        });

        mockRecognitionInstance.addEventListener.mockImplementation(() => {});

        await expect((async () => adapter.listen())()).rejects.toThrow();
      });

      it('ignores duplicate finish calls', async () => {
        const adapter = new WebVoiceAdapter();
        await adapter.init();

        let resultListener: RecognitionListener | null = null;
        let endListener: RecognitionListener | null = null;

        mockRecognitionInstance.addEventListener.mockImplementation(
          (event: string, listener: RecognitionListener) => {
            if (event === 'result') {
              resultListener = listener;
            }
            if (event === 'end') {
              endListener = listener;
            }
          }
        );

        const promise = adapter.listen();

        if (resultListener !== null) {
          (resultListener as RecognitionListener)({
            results: [[{ transcript: 'Hello' }]],
          });
        }

        if (endListener !== null) {
          (endListener as RecognitionListener)();
        }

        const result = await promise;

        expect(result).toBe('Hello');
      });

      it('uses navigator language with en-US fallback for recognition', async () => {
        for (const [language, expected] of [
          ['fr-FR', 'fr-FR'],
          ['', 'en-US'],
        ] as const) {
          setGlobal('navigator', {
            language,
            mediaDevices: {
              getUserMedia: mockGetUserMedia,
            },
          });
          const adapter = new WebVoiceAdapter();
          await adapter.init();
          mockRecognitionInstance.addEventListener.mockImplementation(
            (event: string, listener: RecognitionListener) => {
              if (event === 'end') {
                setTimeout(() => listener(), 0);
              }
            }
          );
          await adapter.listen();
          expect(mockRecognitionInstance.lang).toBe(expected);
        }
      });
    });
  });
});
