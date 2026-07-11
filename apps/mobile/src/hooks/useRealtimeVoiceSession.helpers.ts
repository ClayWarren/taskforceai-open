import {
  fetchRealtimeVoiceSetup,
  RealtimeVoiceSetupPrefetchCache,
  type RealtimeVoiceSessionConfig,
  type RealtimeVoiceSetupResponse,
  type VoiceGatewayRequestOptions,
} from '@taskforceai/client-runtime';
import { type AudioStreamBuffer, type AudioStreamEncoding } from 'expo-audio';

import { createModuleLogger } from '../logger';
import { createMobileVoiceGatewayRequestOptions } from '../voice/voiceGatewayClient';

const logger = createModuleLogger('useRealtimeVoiceSession');

const PCM16_MAX_ABSOLUTE_VALUE = 32768;

export const toRealtimeErrorMessage = (error: unknown): string =>
  error instanceof Error && error.message
    ? error.message
    : 'Realtime voice is unavailable. Please try again.';

const prefetchedMobileRealtimeSetupCache =
  new RealtimeVoiceSetupPrefetchCache<RealtimeVoiceSetupResponse>();
let mobileRealtimeSetupPrefetchPromise: Promise<void> | null = null;

const realtimeVoiceAbortError = (signal: AbortSignal): Error => {
  if (signal.reason instanceof Error) {
    return signal.reason;
  }
  const error = new Error('Realtime voice setup was aborted.');
  error.name = 'AbortError';
  return error;
};

const getMobileRealtimeSetupCacheKey = (
  sessionConfig: RealtimeVoiceSessionConfig,
  options: VoiceGatewayRequestOptions
): string => {
  const headers = new Headers(options.headers);
  return [
    options.baseUrl ?? '',
    headers.get('authorization') ?? '',
    JSON.stringify(sessionConfig),
  ].join('\u001f');
};

export const prewarmMobileRealtimeVoiceSetup = (
  sessionConfig: RealtimeVoiceSessionConfig
): void => {
  if (mobileRealtimeSetupPrefetchPromise) {
    return;
  }

  mobileRealtimeSetupPrefetchPromise = (async () => {
    const options = await createMobileVoiceGatewayRequestOptions();
    const key = getMobileRealtimeSetupCacheKey(sessionConfig, options);
    if (prefetchedMobileRealtimeSetupCache.hasFresh(key)) {
      return;
    }

    const setup = await fetchRealtimeVoiceSetup({
      ...options,
      sessionConfig,
    });
    prefetchedMobileRealtimeSetupCache.store(key, setup);
  })()
    .catch((error) => {
      logger.debug('Realtime voice setup prewarm failed', { error });
    })
    .finally(() => {
      mobileRealtimeSetupPrefetchPromise = null;
    });
};

const consumePrefetchedMobileRealtimeSetup = async (
  sessionConfig: RealtimeVoiceSessionConfig,
  options: VoiceGatewayRequestOptions,
  signal: AbortSignal
): Promise<RealtimeVoiceSetupResponse | null> => {
  if (mobileRealtimeSetupPrefetchPromise) {
    if (signal.aborted) {
      throw realtimeVoiceAbortError(signal);
    }
    let handleAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      handleAbort = () => reject(realtimeVoiceAbortError(signal));
      signal.addEventListener('abort', handleAbort, { once: true });
    });
    try {
      await Promise.race([
        mobileRealtimeSetupPrefetchPromise.catch(() => undefined),
        aborted,
      ]);
    } finally {
      if (handleAbort) {
        signal.removeEventListener('abort', handleAbort);
      }
    }
  }

  const key = getMobileRealtimeSetupCacheKey(sessionConfig, options);
  return prefetchedMobileRealtimeSetupCache.consume(key);
};

export const fetchMobileRealtimeVoiceSetup = async ({
  sessionConfig,
  signal,
}: {
  sessionConfig: RealtimeVoiceSessionConfig;
  signal: AbortSignal;
}): Promise<RealtimeVoiceSetupResponse> => {
  const options = await createMobileVoiceGatewayRequestOptions();
  const prefetchedSetup = await consumePrefetchedMobileRealtimeSetup(
    sessionConfig,
    options,
    signal
  );
  if (prefetchedSetup) {
    return prefetchedSetup;
  }

  return fetchRealtimeVoiceSetup({
    ...options,
    sessionConfig,
    signal,
  });
};

const getBytesPerSample = (encoding: AudioStreamEncoding): number =>
  encoding === 'float32' ? Float32Array.BYTES_PER_ELEMENT : Int16Array.BYTES_PER_ELEMENT;

export const estimateAudioDurationMs = (
  buffer: AudioStreamBuffer,
  encoding: AudioStreamEncoding
): number => {
  const sampleRate = Math.max(1, buffer.sampleRate);
  const channels = Math.max(1, buffer.channels);
  const sampleCount = Math.floor(buffer.data.byteLength / getBytesPerSample(encoding));
  const frameCount = Math.max(0, Math.floor(sampleCount / channels));
  return (frameCount / sampleRate) * 1000;
};

export const calculatePcmRmsLevel = (
  data: ArrayBuffer | ArrayBufferView,
  encoding: AudioStreamEncoding
): number => {
  const view = ArrayBuffer.isView(data)
    ? new DataView(data.buffer, data.byteOffset, data.byteLength)
    : new DataView(data);
  const bytesPerSample = getBytesPerSample(encoding);
  const sampleCount = Math.floor(view.byteLength / bytesPerSample);
  if (sampleCount === 0) {
    return 0;
  }

  let total = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const normalized =
      encoding === 'float32'
        ? view.getFloat32(index * bytesPerSample, true)
        : view.getInt16(index * bytesPerSample, true) / PCM16_MAX_ABSOLUTE_VALUE;
    total += normalized * normalized;
  }
  return Math.sqrt(total / sampleCount);
};

export type PendingFallbackTranscription = {
  chunks: string[];
  generation: number;
  timeout: ReturnType<typeof setTimeout>;
};
