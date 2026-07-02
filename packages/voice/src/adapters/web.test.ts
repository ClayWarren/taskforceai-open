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

    describe('record', () => {
      let mockMediaRecorder: {
        ondataavailable: ((e: { data: Blob }) => void) | null;
        onstop: (() => void) | null;
        start: ReturnType<typeof vi.fn>;
        stop: ReturnType<typeof vi.fn>;
        state: string;
        mimeType: string;
      };

      const setupMediaRecorder = (mimeType: string) => {
        mockMediaRecorder = {
          ondataavailable: null,
          onstop: null,
          start: vi.fn().mockImplementation(() => {
            // Simulate data available then stop after start
            setTimeout(() => {
              mockMediaRecorder.ondataavailable?.({
                data: new Blob(['audio-data'], { type: mimeType }),
              });
              mockMediaRecorder.onstop?.();
            }, 0);
          }),
          stop: vi.fn(),
          state: 'inactive',
          mimeType,
        };

        setGlobal(
          'MediaRecorder',
          vi.fn(() => mockMediaRecorder)
        );

        // Mock FileReader for bun test environment
        setGlobal(
          'FileReader',
          class {
            result: string | null = null;
            onloadend: (() => void) | null = null;

            addEventListener(_event: string, _listener: () => void) {}

            readAsDataURL(_blob: Blob) {
              this.result = 'data:audio/webm;base64,dGVzdA==';
              setTimeout(() => this.onloadend?.(), 0);
            }
          }
        );

        const mockStream = {
          getTracks: () => [{ stop: vi.fn() }],
        };
        mockGetUserMedia.mockResolvedValue(mockStream);
      };

      it('maps recorder MIME types to output formats', async () => {
        for (const [mimeType, format] of [
          ['audio/webm;codecs=opus', 'webm'],
          ['audio/mp3', 'mp3'],
          ['audio/mpeg', 'mp3'],
          ['audio/wav', 'wav'],
          ['audio/ogg', 'webm'],
        ] as const) {
          setupMediaRecorder(mimeType);
          const adapter = new WebVoiceAdapter();
          await adapter.init();
          const result = await adapter.record();
          expect(result.format).toBe(format);
          expect(result.data).toBeDefined();
        }
      });

      it('records without speech recognition or synthesis support', async () => {
        setupMediaRecorder('audio/webm;codecs=opus');
        setGlobal('window', {});

        const adapter = new WebVoiceAdapter();

        await expect(adapter.init()).resolves.toBeUndefined();
        await expect(adapter.record()).resolves.toEqual({ data: 'dGVzdA==', format: 'webm' });
      });

      it('finishes an active recording without cancelling it', async () => {
        const stopTrack = vi.fn();
        mockMediaRecorder = {
          ondataavailable: null,
          onstop: null,
          start: vi.fn(() => {
            mockMediaRecorder.state = 'recording';
          }),
          stop: vi.fn(() => {
            mockMediaRecorder.state = 'inactive';
            mockMediaRecorder.ondataavailable?.({
              data: new Blob(['audio-data'], { type: 'audio/webm' }),
            });
            mockMediaRecorder.onstop?.();
          }),
          state: 'inactive',
          mimeType: 'audio/webm',
        };

        setGlobal(
          'MediaRecorder',
          vi.fn(() => mockMediaRecorder)
        );
        setGlobal(
          'FileReader',
          class {
            result: string | null = null;
            onloadend: (() => void) | null = null;

            addEventListener(_event: string, _listener: () => void) {}

            readAsDataURL(_blob: Blob) {
              this.result = 'data:audio/webm;base64,dGVzdA==';
              setTimeout(() => this.onloadend?.(), 0);
            }
          }
        );
        mockGetUserMedia.mockResolvedValue({
          getTracks: () => [{ stop: stopTrack }],
        });

        const adapter = new WebVoiceAdapter();
        await adapter.init();
        stopTrack.mockClear();

        const recordPromise = adapter.record();
        await new Promise((resolve) => setTimeout(resolve, 0));
        await adapter.finishListening();

        await expect(recordPromise).resolves.toEqual({ data: 'dGVzdA==', format: 'webm' });
        expect(mockMediaRecorder.stop).toHaveBeenCalledTimes(1);
        expect(stopTrack).toHaveBeenCalledTimes(1);
      });

      it('rejects with cancelled error when recording is cancelled', async () => {
        const mockRecorder = {
          ondataavailable: null as ((e: { data: Blob }) => void) | null,
          onstop: null as (() => void) | null,
          start: vi.fn(),
          stop: vi.fn(),
          state: 'recording',
          mimeType: 'audio/webm',
        };

        mockRecorder.stop.mockImplementation(() => {
          mockRecorder.state = 'inactive';
          mockRecorder.onstop?.();
        });

        setGlobal(
          'MediaRecorder',
          vi.fn(() => mockRecorder)
        );

        mockGetUserMedia.mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() }],
        });

        const adapter = new WebVoiceAdapter();
        await adapter.init();

        const recordPromise = adapter.record();
        await Promise.resolve();
        await adapter.cancel();

        await expect(recordPromise).rejects.toThrow('Voice input cancelled.');
      });

      it('cancels promptly while microphone access is still pending', async () => {
        mockGetUserMedia.mockImplementation(
          () =>
            new Promise((resolve) => {
              setTimeout(
                () =>
                  resolve({
                    getTracks: () => [{ stop: vi.fn() }],
                  }),
                25
              );
            })
        );

        const adapter = new WebVoiceAdapter();
        await adapter.init();

        const recordPromise = adapter.record();
        await adapter.cancel();

        const outcome = await Promise.race([
          recordPromise
            .then(() => 'resolved')
            .catch((error) => (error instanceof Error ? error.message : String(error))),
          new Promise<string>((resolve) => setTimeout(() => resolve('timed-out'), 100)),
        ]);

        expect(outcome).toBe('Voice input cancelled.');
      });

      it('stops acquired stream when MediaRecorder setup fails', async () => {
        const stopTrack = vi.fn();
        mockGetUserMedia.mockResolvedValue({
          getTracks: () => [{ stop: stopTrack }],
        });

        function FailingMediaRecorder() {
          throw new Error('MediaRecorder constructor failed');
        }

        setGlobal('MediaRecorder', FailingMediaRecorder);

        const adapter = new WebVoiceAdapter();

        await expect(adapter.record()).rejects.toThrow(
          'Failed to start recording: MediaRecorder constructor failed'
        );
        expect(stopTrack).toHaveBeenCalledTimes(1);
      });

      it('rejects when recorded audio cannot be read', async () => {
        setupMediaRecorder('audio/webm');

        setGlobal(
          'FileReader',
          class {
            result: string | null = null;

            addEventListener(event: string, listener: () => void) {
              if (event === 'error') {
                setTimeout(listener, 0);
              }
            }

            readAsDataURL(_blob: Blob) {}
          }
        );

        const adapter = new WebVoiceAdapter();
        await adapter.init();

        await expect(adapter.record()).rejects.toThrow('Failed to read recorded audio');
      });

      it('rejects when automatic recording stop fails', async () => {
        vi.useFakeTimers();
        const mockRecorder = {
          ondataavailable: null as ((e: { data: Blob }) => void) | null,
          onstop: null as (() => void) | null,
          start: vi.fn(),
          stop: vi.fn(() => {
            throw new Error('Stop failed');
          }),
          state: 'recording',
          mimeType: 'audio/webm',
        };

        setGlobal(
          'MediaRecorder',
          vi.fn(() => mockRecorder)
        );

        mockGetUserMedia.mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() }],
        });

        const adapter = new WebVoiceAdapter();
        await adapter.init();

        const recordPromise = adapter.record();
        await Promise.resolve();
        vi.advanceTimersByTime(60_000);

        await expect(recordPromise).rejects.toThrow('Failed to stop recording');
      });
    });

    describe('cancel', () => {
      it('cancels speech, active recognition, and tolerates missing speech synthesis', async () => {
        const adapter = new WebVoiceAdapter();
        await adapter.init();

        await adapter.cancel();

        expect(mockSpeechSynthesis.cancel).toHaveBeenCalled();

        mockRecognitionInstance.addEventListener.mockImplementation(() => {});
        adapter.listen().catch(() => {}); // Don't await
        await adapter.cancel();
        expect(mockRecognitionInstance.stop).toHaveBeenCalled();

        setGlobal('window', {
          SpeechRecognition: mockSpeechRecognition,
        });
        expect(await adapter.cancel()).toBeUndefined();
      });

      it('handles stop() throwing error', async () => {
        const adapter = new WebVoiceAdapter();
        await adapter.init();

        mockRecognitionInstance.addEventListener.mockImplementation(
          (_event: string, _listener: RecognitionListener) => {}
        );

        mockRecognitionInstance.stop.mockImplementation(() => {
          throw new Error('Stop failed');
        });

        const listenPromise = adapter.listen();

        // Should not throw
        expect(await adapter.cancel()).toBeUndefined();
        await expect(listenPromise).rejects.toThrow('Voice input cancelled.');
      });
    });
  });
});
