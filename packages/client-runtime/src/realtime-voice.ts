import { definedProps } from '@taskforceai/shared/utils/object';

import {
  resolveVoiceMediaUrl,
  type VoiceGatewayRequestOptions,
  type VoiceMediaFetch,
} from './voice-media';

export const REALTIME_SETUP_ENDPOINT = '/api/realtime/setup';
export const REALTIME_VOICE_MODEL_ID = 'xai/grok-voice-think-fast-1.0';
export const REALTIME_INPUT_SAMPLE_RATE = 24000;
export const REALTIME_OUTPUT_SAMPLE_RATE = 24000;

const REALTIME_PROTOCOL_VERSION = 'ai-gateway-realtime.v1';
const REALTIME_AUTH_PROTOCOL_PREFIX = 'ai-gateway-auth.';
const REALTIME_TEAM_PROTOCOL_PREFIX = 'ai-gateway-team.';
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP = new Map<string, number>(
  Array.from(BASE64_ALPHABET).map((character, index) => [character, index])
);

export interface RealtimeVoiceAudioFormat {
  type: 'audio/pcm';
  rate: number;
}

export interface RealtimeVoiceSessionConfig {
  instructions?: string;
  voice?: string;
  outputModalities?: Array<'audio' | 'text'>;
  inputAudioFormat?: RealtimeVoiceAudioFormat;
  inputAudioTranscription?: Record<string, unknown>;
  outputAudioFormat?: RealtimeVoiceAudioFormat;
  outputAudioTranscription?: Record<string, unknown>;
  turnDetection?: {
    type: 'server-vad' | 'semantic-vad' | 'disabled';
    [key: string]: unknown;
  };
  tools?: unknown[];
  providerOptions?: Record<string, unknown>;
  [key: string]: unknown;
}

export type RealtimeVoiceClientEvent =
  | { type: 'session-update'; config: RealtimeVoiceSessionConfig }
  | { type: 'input-audio-append'; audio: string }
  | { type: 'input-audio-commit' }
  | { type: 'input-audio-clear' }
  | { type: 'response-create'; options?: Record<string, unknown> }
  | { type: 'response-cancel' }
  | { type: 'conversation-item-create'; item: unknown }
  | {
      type: 'conversation-item-truncate';
      itemId: string;
      contentIndex: number;
      audioEndMs: number;
    };

export type RealtimeVoiceServerEvent =
  | { type: 'session-created'; sessionId?: string; raw?: unknown }
  | { type: 'session-updated'; raw?: unknown }
  | { type: 'speech-started'; itemId?: string; raw?: unknown }
  | { type: 'speech-stopped'; itemId?: string; raw?: unknown }
  | { type: 'audio-committed'; itemId?: string; previousItemId?: string; raw?: unknown }
  | { type: 'input-transcription-completed'; itemId: string; transcript: string; raw?: unknown }
  | { type: 'response-created'; responseId: string; raw?: unknown }
  | { type: 'response-done'; responseId: string; status: string; raw?: unknown }
  | { type: 'audio-delta'; responseId?: string; itemId: string; delta: string; raw?: unknown }
  | { type: 'audio-done'; responseId?: string; itemId: string; raw?: unknown }
  | { type: 'audio-transcript-delta'; itemId: string; delta: string; raw?: unknown }
  | { type: 'audio-transcript-done'; itemId: string; transcript?: string; raw?: unknown }
  | { type: 'text-delta'; itemId: string; delta: string; raw?: unknown }
  | { type: 'text-done'; itemId: string; text?: string; raw?: unknown }
  | { type: 'error'; message: string; raw?: unknown }
  | { type: string; [key: string]: unknown };

export const readRealtimeVoiceServerEventText = async (data: unknown): Promise<string | null> => {
  if (typeof data === 'string') {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }

  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data);
  }

  if (typeof Blob !== 'undefined' && data instanceof Blob && typeof data.text === 'function') {
    return data.text();
  }

  return null;
};

export const parseRealtimeVoiceServerEvent = async (
  data: unknown
): Promise<RealtimeVoiceServerEvent | null> => {
  const text = await readRealtimeVoiceServerEventText(data);
  if (text === null) {
    return null;
  }

  try {
    const payload = JSON.parse(text) as Partial<RealtimeVoiceServerEvent>;
    return typeof payload.type === 'string' ? (payload as RealtimeVoiceServerEvent) : null;
  } catch {
    return null;
  }
};

export interface RealtimeVoiceToolDefinition {
  [key: string]: unknown;
}

export interface RealtimeVoiceSetupResponse {
  token: string;
  url: string;
  expiresAt?: number;
  tools?: RealtimeVoiceToolDefinition[];
}

export interface FetchRealtimeVoiceSetupOptions extends VoiceGatewayRequestOptions {
  sessionConfig?: RealtimeVoiceSessionConfig;
}

export const DEFAULT_REALTIME_VOICE_INSTRUCTIONS =
  'You are TaskForceAI in a live voice conversation. Keep replies concise, useful, and easy to interrupt.';

const jsonContentTypeHeaders = new Headers({
  'content-type': 'application/json',
});

const mergeHeaders = (...headerSets: (HeadersInit | undefined)[]): Headers => {
  const headers = new Headers();
  for (const headerSet of headerSets) {
    if (!headerSet) {
      continue;
    }
    new Headers(headerSet).forEach((value, key) => {
      headers.set(key, value);
    });
  }
  return headers;
};

const readResponseErrorMessage = async (response: Response): Promise<string | null> => {
  try {
    const payload = (await response.json()) as { error?: unknown };
    return typeof payload.error === 'string' ? payload.error : null;
  } catch {
    return null;
  }
};

const buildRealtimeSetupErrorMessage = async (response: Response): Promise<string> => {
  const responseError = await readResponseErrorMessage(response);
  if (responseError) {
    return responseError;
  }
  if (response.status === 401) {
    return 'Sign in to use realtime voice.';
  }
  if (response.status === 403) {
    return 'Realtime voice is not available for this account.';
  }
  if (response.status === 503) {
    return 'Realtime voice is not configured for this deployment.';
  }
  return `Failed to fetch realtime setup: ${response.status}`;
};

const base64UrlEncode = (value: string): string =>
  bytesToBase64(new TextEncoder().encode(value))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');

export const getGatewayRealtimeProtocols = (
  token: string,
  options: { teamId?: string | null } = {}
): string[] => {
  const protocols = [REALTIME_PROTOCOL_VERSION, `${REALTIME_AUTH_PROTOCOL_PREFIX}${token}`];
  if (options.teamId) {
    protocols.push(`${REALTIME_TEAM_PROTOCOL_PREFIX}${base64UrlEncode(options.teamId)}`);
  }
  return protocols;
};

export const buildRealtimeVoiceSessionConfig = (
  overrides: RealtimeVoiceSessionConfig = {}
): RealtimeVoiceSessionConfig => ({
  instructions: DEFAULT_REALTIME_VOICE_INSTRUCTIONS,
  inputAudioFormat: {
    type: 'audio/pcm',
    rate: REALTIME_INPUT_SAMPLE_RATE,
  },
  inputAudioTranscription: {},
  outputAudioFormat: {
    type: 'audio/pcm',
    rate: REALTIME_OUTPUT_SAMPLE_RATE,
  },
  outputAudioTranscription: {},
  outputModalities: ['audio'],
  turnDetection: { type: 'server-vad' },
  ...overrides,
});

export const fetchRealtimeVoiceSetup = async (
  options: FetchRealtimeVoiceSetupOptions = {}
): Promise<RealtimeVoiceSetupResponse> => {
  const fetchImpl: VoiceMediaFetch = options.fetchImpl ?? fetch;
  const response = await fetchImpl(resolveVoiceMediaUrl(REALTIME_SETUP_ENDPOINT, options.baseUrl), {
    method: 'POST',
    headers: mergeHeaders(jsonContentTypeHeaders, options.headers),
    body: JSON.stringify({ sessionConfig: options.sessionConfig }),
    ...definedProps({ signal: options.signal }),
  });

  if (!response.ok) {
    throw new Error(await buildRealtimeSetupErrorMessage(response));
  }

  const payload = (await response.json()) as Partial<RealtimeVoiceSetupResponse>;
  if (typeof payload.token !== 'string' || typeof payload.url !== 'string') {
    throw new Error('Realtime setup returned an invalid response.');
  }

  return {
    token: payload.token,
    url: payload.url,
    tools: Array.isArray(payload.tools) ? payload.tools : [],
    ...definedProps({ expiresAt: payload.expiresAt }),
  };
};

export const bytesToBase64 = (bytes: Uint8Array): string => {
  let result = '';
  let index = 0;
  while (index < bytes.byteLength) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];

    result += BASE64_ALPHABET[first >> 2];
    result += BASE64_ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >> 4)];
    result +=
      second === undefined ? '=' : BASE64_ALPHABET[((second & 0x0f) << 2) | ((third ?? 0) >> 6)];
    result += third === undefined ? '=' : BASE64_ALPHABET[third & 0x3f];
    index += 3;
  }
  return result;
};

export const arrayBufferToBase64 = (input: ArrayBuffer | ArrayBufferView): string => {
  const bytes = ArrayBuffer.isView(input)
    ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
    : new Uint8Array(input);
  return bytesToBase64(bytes);
};

const clampPcm16Sample = (sample: number): number =>
  Math.max(-32768, Math.min(32767, Math.round(sample)));

const clampFloat32Sample = (sample: number): number => Math.max(-1, Math.min(1, sample));

const getPcm16ByteView = (input: ArrayBuffer | ArrayBufferView): DataView => {
  if (ArrayBuffer.isView(input)) {
    return new DataView(input.buffer, input.byteOffset, input.byteLength);
  }
  return new DataView(input);
};

const readMonoPcm16Sample = (view: DataView, frameIndex: number, channels: number): number => {
  const firstByteOffset = frameIndex * channels * 2;
  let total = 0;
  for (let channel = 0; channel < channels; channel += 1) {
    total += view.getInt16(firstByteOffset + channel * 2, true);
  }
  return total / channels;
};

export const normalizePcm16AudioBufferToBase64 = (
  input: ArrayBuffer | ArrayBufferView,
  options: {
    inputSampleRate: number;
    inputChannels?: number;
    outputSampleRate?: number;
  }
): string => {
  const inputSampleRate = Math.round(options.inputSampleRate);
  const inputChannels = Math.max(1, Math.round(options.inputChannels ?? 1));
  const outputSampleRate = Math.round(options.outputSampleRate ?? REALTIME_INPUT_SAMPLE_RATE);

  if (inputSampleRate <= 0 || outputSampleRate <= 0) {
    return arrayBufferToBase64(input);
  }

  const view = getPcm16ByteView(input);
  const frameCount = Math.floor(view.byteLength / (inputChannels * 2));
  if (frameCount <= 0) {
    return '';
  }

  if (inputSampleRate === outputSampleRate && inputChannels === 1) {
    return arrayBufferToBase64(input);
  }

  const outputFrameCount = Math.max(
    1,
    Math.round((frameCount * outputSampleRate) / inputSampleRate)
  );
  const outputBuffer = new ArrayBuffer(outputFrameCount * 2);
  const outputView = new DataView(outputBuffer);
  const ratio = inputSampleRate / outputSampleRate;

  for (let outputIndex = 0; outputIndex < outputFrameCount; outputIndex += 1) {
    const sourceIndex = outputIndex * ratio;
    const lowerFrame = Math.min(Math.floor(sourceIndex), frameCount - 1);
    const upperFrame = Math.min(lowerFrame + 1, frameCount - 1);
    const fraction = sourceIndex - lowerFrame;
    const lowerSample = readMonoPcm16Sample(view, lowerFrame, inputChannels);
    const upperSample = readMonoPcm16Sample(view, upperFrame, inputChannels);
    outputView.setInt16(
      outputIndex * 2,
      clampPcm16Sample(lowerSample * (1 - fraction) + upperSample * fraction),
      true
    );
  }

  return arrayBufferToBase64(outputBuffer);
};

const readMonoFloat32Sample = (view: DataView, frameIndex: number, channels: number): number => {
  const firstByteOffset = frameIndex * channels * Float32Array.BYTES_PER_ELEMENT;
  let total = 0;
  for (let channel = 0; channel < channels; channel += 1) {
    total += view.getFloat32(firstByteOffset + channel * Float32Array.BYTES_PER_ELEMENT, true);
  }
  return total / channels;
};

export const normalizeFloat32AudioBufferToBase64 = (
  input: ArrayBuffer | ArrayBufferView,
  options: {
    inputSampleRate: number;
    inputChannels?: number;
    outputSampleRate?: number;
  }
): string => {
  const inputSampleRate = Math.round(options.inputSampleRate);
  const inputChannels = Math.max(1, Math.round(options.inputChannels ?? 1));
  const outputSampleRate = Math.round(options.outputSampleRate ?? REALTIME_INPUT_SAMPLE_RATE);

  if (inputSampleRate <= 0 || outputSampleRate <= 0) {
    return '';
  }

  const view = getPcm16ByteView(input);
  const frameCount = Math.floor(view.byteLength / (inputChannels * Float32Array.BYTES_PER_ELEMENT));
  if (frameCount <= 0) {
    return '';
  }

  const outputFrameCount =
    inputSampleRate === outputSampleRate
      ? frameCount
      : Math.max(1, Math.round((frameCount * outputSampleRate) / inputSampleRate));
  const outputBuffer = new ArrayBuffer(outputFrameCount * Int16Array.BYTES_PER_ELEMENT);
  const outputView = new DataView(outputBuffer);
  const ratio = inputSampleRate / outputSampleRate;

  for (let outputIndex = 0; outputIndex < outputFrameCount; outputIndex += 1) {
    const sourceIndex = outputIndex * ratio;
    const lowerFrame = Math.min(Math.floor(sourceIndex), frameCount - 1);
    const upperFrame = Math.min(lowerFrame + 1, frameCount - 1);
    const fraction = sourceIndex - lowerFrame;
    const lowerSample = readMonoFloat32Sample(view, lowerFrame, inputChannels);
    const upperSample = readMonoFloat32Sample(view, upperFrame, inputChannels);
    const sample = clampFloat32Sample(lowerSample * (1 - fraction) + upperSample * fraction);
    outputView.setInt16(
      outputIndex * Int16Array.BYTES_PER_ELEMENT,
      clampPcm16Sample(sample < 0 ? sample * 0x8000 : sample * 0x7fff),
      true
    );
  }

  return arrayBufferToBase64(outputBuffer);
};

export const normalizeRealtimeAudioBufferToBase64 = (
  input: ArrayBuffer | ArrayBufferView,
  options: {
    inputEncoding: 'pcm16' | 'float32';
    inputSampleRate: number;
    inputChannels?: number;
    outputSampleRate?: number;
  }
): string =>
  options.inputEncoding === 'float32'
    ? normalizeFloat32AudioBufferToBase64(input, options)
    : normalizePcm16AudioBufferToBase64(input, options);

export const base64ToUint8Array = (base64: string): Uint8Array => {
  const normalized = base64.replace(/\s+/gu, '');
  if (!normalized) {
    return new Uint8Array();
  }

  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  const outputLength = Math.floor((normalized.length * 3) / 4) - padding;
  const output = new Uint8Array(outputLength);
  let outputIndex = 0;

  for (let index = 0; index < normalized.length; index += 4) {
    const first = BASE64_LOOKUP.get(normalized[index] ?? '') ?? 0;
    const second = BASE64_LOOKUP.get(normalized[index + 1] ?? '') ?? 0;
    const third =
      normalized[index + 2] === '=' ? 0 : (BASE64_LOOKUP.get(normalized[index + 2] ?? '') ?? 0);
    const fourth =
      normalized[index + 3] === '=' ? 0 : (BASE64_LOOKUP.get(normalized[index + 3] ?? '') ?? 0);

    const combined = (first << 18) | (second << 12) | (third << 6) | fourth;
    if (outputIndex < outputLength) output[outputIndex++] = (combined >> 16) & 0xff;
    if (outputIndex < outputLength) output[outputIndex++] = (combined >> 8) & 0xff;
    if (outputIndex < outputLength) output[outputIndex++] = combined & 0xff;
  }

  return output;
};

export const getBase64DecodedByteLength = (base64: string): number => {
  const normalized = base64.replace(/\s+/gu, '');
  if (!normalized) {
    return 0;
  }
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
};

export const mergeBase64Uint8ArrayChunks = (chunks: string[]): Uint8Array => {
  const decodedChunks = chunks.map(base64ToUint8Array);
  const totalBytes = decodedChunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of decodedChunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
};

const writeAscii = (view: DataView, offset: number, value: string) => {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
};

export const pcm16BytesToWavBytes = (
  pcmBytes: Uint8Array,
  options: { sampleRate?: number; channels?: number } = {}
): Uint8Array => {
  const sampleRate = options.sampleRate ?? REALTIME_OUTPUT_SAMPLE_RATE;
  const channels = options.channels ?? 1;
  const bytesPerSample = 2;
  const wavBytes = new Uint8Array(44 + pcmBytes.byteLength);
  const view = new DataView(wavBytes.buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + pcmBytes.byteLength, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, pcmBytes.byteLength, true);
  wavBytes.set(pcmBytes, 44);

  return wavBytes;
};

export const pcm16Base64ToWavBytes = (
  base64Pcm: string,
  options: { sampleRate?: number; channels?: number } = {}
): Uint8Array => pcm16BytesToWavBytes(base64ToUint8Array(base64Pcm), options);

export const serializeRealtimeVoiceEvent = (event: RealtimeVoiceClientEvent): string =>
  JSON.stringify(event);
