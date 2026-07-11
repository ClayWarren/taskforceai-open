import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import type {
  RealtimeVoiceSessionConfig,
  RealtimeVoiceSetupResponse,
} from '@taskforceai/client-runtime';

const mockFetchRealtimeVoiceSetup = jest.fn();
const mockCreateMobileVoiceGatewayRequestOptions = jest.fn();
const mockDebug = jest.fn();

jest.mock('@taskforceai/client-runtime', () => {
  const actualClientRuntime =
    jest.requireActual<typeof import('@taskforceai/client-runtime')>('@taskforceai/client-runtime');
  return {
    __esModule: true,
    ...actualClientRuntime,
    fetchRealtimeVoiceSetup: mockFetchRealtimeVoiceSetup,
  };
});

jest.mock('../../voice/voiceGatewayClient', () => ({
  createMobileVoiceGatewayRequestOptions: mockCreateMobileVoiceGatewayRequestOptions,
}));

jest.mock('../../logger', () => ({
  createModuleLogger: () => ({
    debug: mockDebug,
  }),
}));

const flushAsyncWork = async () => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const createDeferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

const createSessionConfig = (id: string): RealtimeVoiceSessionConfig => ({
  instructions: `Talk through ${id}.`,
  outputModalities: ['audio'],
});

const createSetup = (token: string): RealtimeVoiceSetupResponse => ({
  expiresAt: Date.now() + 60_000,
  token,
  tools: [{ name: 'search' }],
  url: `wss://voice.example/${token}`,
});

const loadHelpers = () =>
  require('../../hooks/useRealtimeVoiceSession.helpers') as typeof import('../../hooks/useRealtimeVoiceSession.helpers');

describe('useRealtimeVoiceSession helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateMobileVoiceGatewayRequestOptions.mockResolvedValue({
      baseUrl: 'https://gateway.example',
      headers: { authorization: 'Bearer mobile' },
    } as never);
  });

  it('normalizes realtime setup errors for display', () => {
    const { toRealtimeErrorMessage } = loadHelpers();

    expect(toRealtimeErrorMessage(new Error('Gateway refused realtime voice.'))).toBe(
      'Gateway refused realtime voice.'
    );
    expect(toRealtimeErrorMessage(new Error())).toBe(
      'Realtime voice is unavailable. Please try again.'
    );
    expect(toRealtimeErrorMessage('offline')).toBe(
      'Realtime voice is unavailable. Please try again.'
    );
  });

  it('estimates audio duration and RMS levels for native buffers', () => {
    const { calculatePcmRmsLevel, estimateAudioDurationMs } = loadHelpers();

    expect(
      estimateAudioDurationMs(
        {
          channels: 2,
          data: new Int16Array(4_800).buffer,
          sampleRate: 24_000,
        },
        'pcm16'
      )
    ).toBe(100);

    expect(
      estimateAudioDurationMs(
        {
          channels: 0,
          data: new Int16Array(4).buffer,
          sampleRate: 0,
        },
        'pcm16'
      )
    ).toBe(4_000);

    expect(calculatePcmRmsLevel(new ArrayBuffer(0), 'pcm16')).toBe(0);
    expect(calculatePcmRmsLevel(new Int16Array([0, 16_384, -16_384]).buffer, 'pcm16')).toBeCloseTo(
      Math.sqrt(0.5 / 3),
      6
    );
    expect(calculatePcmRmsLevel(new Float32Array([0.5, -0.5]), 'float32')).toBeCloseTo(
      0.5,
      6
    );
  });

  it('prewarms, refresh-checks, and consumes cached realtime setup', async () => {
    const { fetchMobileRealtimeVoiceSetup, prewarmMobileRealtimeVoiceSetup } = loadHelpers();
    const sessionConfig = createSessionConfig('prefetch-consume');
    const setup = createSetup('prefetch-token');
    mockFetchRealtimeVoiceSetup.mockResolvedValue(setup as never);

    prewarmMobileRealtimeVoiceSetup(sessionConfig);
    await flushAsyncWork();

    prewarmMobileRealtimeVoiceSetup(sessionConfig);
    await flushAsyncWork();

    await expect(
      fetchMobileRealtimeVoiceSetup({
        sessionConfig,
        signal: new AbortController().signal,
      })
    ).resolves.toBe(setup);

    expect(mockFetchRealtimeVoiceSetup).toHaveBeenCalledTimes(1);
    expect(mockFetchRealtimeVoiceSetup).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'https://gateway.example',
        headers: { authorization: 'Bearer mobile' },
        sessionConfig,
      })
    );
  });

  it('awaits an in-flight prewarm before consuming cached setup', async () => {
    const { fetchMobileRealtimeVoiceSetup, prewarmMobileRealtimeVoiceSetup } = loadHelpers();
    const sessionConfig = createSessionConfig('pending-prewarm');
    const setup = createSetup('pending-token');
    const setupDeferred = createDeferred<RealtimeVoiceSetupResponse>();
    mockFetchRealtimeVoiceSetup.mockReturnValueOnce(setupDeferred.promise as never);

    prewarmMobileRealtimeVoiceSetup(sessionConfig);
    const fetchPromise = fetchMobileRealtimeVoiceSetup({
      sessionConfig,
      signal: new AbortController().signal,
    });

    await flushAsyncWork();
    expect(mockFetchRealtimeVoiceSetup).toHaveBeenCalledTimes(1);

    setupDeferred.resolve(setup);
    await expect(fetchPromise).resolves.toBe(setup);
    expect(mockFetchRealtimeVoiceSetup).toHaveBeenCalledTimes(1);
  });

  it('does not make cancellation wait for an in-flight prewarm', async () => {
    const { fetchMobileRealtimeVoiceSetup, prewarmMobileRealtimeVoiceSetup } = loadHelpers();
    const sessionConfig = createSessionConfig('cancel-pending-prewarm');
    const setupDeferred = createDeferred<RealtimeVoiceSetupResponse>();
    mockFetchRealtimeVoiceSetup.mockReturnValueOnce(setupDeferred.promise as never);

    prewarmMobileRealtimeVoiceSetup(sessionConfig);
    const controller = new AbortController();
    const fetchPromise = fetchMobileRealtimeVoiceSetup({
      sessionConfig,
      signal: controller.signal,
    });
    await flushAsyncWork();

    controller.abort();

    await expect(fetchPromise).rejects.toMatchObject({ name: 'AbortError' });
    setupDeferred.resolve(createSetup('unused-prefetch-token'));
    await flushAsyncWork();
  });

  it('rejects an already-aborted request while a prewarm is in flight', async () => {
    const { fetchMobileRealtimeVoiceSetup, prewarmMobileRealtimeVoiceSetup } = loadHelpers();
    const sessionConfig = createSessionConfig('already-cancelled-prewarm');
    const setupDeferred = createDeferred<RealtimeVoiceSetupResponse>();
    mockFetchRealtimeVoiceSetup.mockReturnValueOnce(setupDeferred.promise as never);

    prewarmMobileRealtimeVoiceSetup(sessionConfig);
    const controller = new AbortController();
    const cancellation = new Error('Voice setup was cancelled before it started.');
    controller.abort(cancellation);

    await expect(
      fetchMobileRealtimeVoiceSetup({
        sessionConfig,
        signal: controller.signal,
      })
    ).rejects.toBe(cancellation);

    setupDeferred.resolve(createSetup('unused-already-cancelled-token'));
    await flushAsyncWork();
  });

  it('logs failed prewarms and falls back to live setup fetches', async () => {
    const { fetchMobileRealtimeVoiceSetup, prewarmMobileRealtimeVoiceSetup } = loadHelpers();
    const sessionConfig = createSessionConfig('failed-prewarm');
    const setup = createSetup('live-token');
    mockFetchRealtimeVoiceSetup
      .mockRejectedValueOnce(new Error('prewarm failed') as never)
      .mockResolvedValueOnce(setup as never);

    prewarmMobileRealtimeVoiceSetup(sessionConfig);
    await flushAsyncWork();

    expect(mockDebug).toHaveBeenCalledWith('Realtime voice setup prewarm failed', {
      error: expect.any(Error),
    });
    await expect(
      fetchMobileRealtimeVoiceSetup({
        sessionConfig,
        signal: new AbortController().signal,
      })
    ).resolves.toBe(setup);
    expect(mockFetchRealtimeVoiceSetup).toHaveBeenCalledTimes(2);
    expect(mockFetchRealtimeVoiceSetup).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sessionConfig,
        signal: expect.any(AbortSignal),
      })
    );
  });
});
