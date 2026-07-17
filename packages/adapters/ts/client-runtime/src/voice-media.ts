import { definedProps } from '@taskforceai/client-core/utils/object';

import { jsonContentTypeHeaders, mergeHeaders, readJsonErrorMessage } from './voice-http';

export const DICTATION_TRANSCRIBE_ENDPOINT = '/api/dictation/transcribe';
export const SPEECH_GENERATE_ENDPOINT = '/api/speech/generate';
export const MAX_SPEECH_TEXT_CHARS = 12_000;

export type VoiceMediaFetch = typeof fetch;

export type NativeFormDataFile = {
  uri: string;
  name: string;
  type: string;
};

export type NativeBase64Audio = {
  data: string;
  format?: string;
  filename?: string;
  mediaType?: string;
  mimeType?: string;
};

export type VoiceAudioInput = Blob | File | NativeFormDataFile | NativeBase64Audio;

export interface VoiceRecordingLike {
  data?: string;
  format: string;
  filename?: string;
  mimeType?: string;
  uri?: string;
}

export interface VoiceGatewayRequestOptions {
  baseUrl?: string | URL | null;
  fetchImpl?: VoiceMediaFetch;
  headers?: HeadersInit;
  signal?: AbortSignal;
}

export interface SpeechAudioResult {
  bytes: Uint8Array;
  mediaType: string;
  format: string;
}

export interface SpeechTextChunkOptions {
  maxTextChars?: number;
  firstChunkChars?: number;
  chunkChars?: number;
  minBoundaryRatio?: number;
}

export const resolveVoiceMediaUrl = (endpoint: string, baseUrl?: string | URL | null): string => {
  if (!baseUrl) {
    return endpoint;
  }

  const base = String(baseUrl).trim();
  if (!base) {
    return endpoint;
  }

  return new URL(endpoint, base.endsWith('/') ? base : `${base}/`).toString();
};

const buildDictationErrorMessage = async (response: Response): Promise<string> => {
  if (response.status === 401) {
    return 'Sign in to use dictation.';
  }
  const responseError = await readJsonErrorMessage(response);
  if (responseError) {
    return responseError;
  }
  if (response.status === 503) {
    return 'Dictation is not configured for this deployment.';
  }
  return `Failed to transcribe dictation: ${response.status}`;
};

const buildSpeechErrorMessage = async (response: Response): Promise<string> => {
  if (response.status === 401) {
    return 'Sign in to listen to responses.';
  }
  const responseError = await readJsonErrorMessage(response);
  if (responseError) {
    return responseError;
  }
  if (response.status === 503) {
    return 'Speech generation is not configured for this deployment.';
  }
  return `Failed to generate speech: ${response.status}`;
};

type ReactNativeFormData = {
  append(name: string, value: NativeFormDataFile): void;
};

const isNativeFormDataFile = (value: VoiceAudioInput): value is NativeFormDataFile =>
  typeof value === 'object' &&
  value !== null &&
  'uri' in value &&
  typeof value.uri === 'string' &&
  'name' in value &&
  typeof value.name === 'string' &&
  'type' in value &&
  typeof value.type === 'string';

const isNativeBase64Audio = (value: VoiceAudioInput): value is NativeBase64Audio =>
  typeof value === 'object' && value !== null && 'data' in value && typeof value.data === 'string';

const inferAudioMediaType = (audio: NativeBase64Audio): string => {
  if (audio.mediaType) {
    return audio.mediaType;
  }
  if (audio.mimeType) {
    return audio.mimeType;
  }
  const format = audio.format?.replace(/^\./u, '').toLowerCase();
  if (format === 'mp3') {
    return 'audio/mpeg';
  }
  if (format === 'wav') {
    return 'audio/wav';
  }
  if (format === '3gp') {
    return 'audio/3gpp';
  }
  return 'audio/mp4';
};

const getBase64AudioFilename = (audio: NativeBase64Audio): string => {
  if (audio.filename) {
    return audio.filename;
  }
  const format = audio.format?.replace(/^\./u, '').toLowerCase() || 'm4a';
  return `voice-recording.${format}`;
};

const appendDictationAudio = (
  formData: FormData,
  audio: Blob | File | NativeFormDataFile
): void => {
  if (isNativeFormDataFile(audio)) {
    (formData as unknown as ReactNativeFormData).append('audio', audio);
    return;
  }

  formData.append('audio', audio);
};

export const voiceRecordingToNativeAudioFile = (
  recording: VoiceRecordingLike
): NativeFormDataFile => {
  if (!recording.uri) {
    throw new Error('Voice recording did not include a native audio file.');
  }
  return {
    uri: recording.uri,
    name: recording.filename || `voice-recording.${recording.format}`,
    type: recording.mimeType || `audio/${recording.format}`,
  };
};

export const voiceRecordingToNativeBase64Audio = (
  recording: VoiceRecordingLike
): NativeBase64Audio | null => {
  if (!recording.data) {
    return null;
  }
  return {
    data: recording.data,
    filename: recording.filename || `voice-recording.${recording.format}`,
    format: recording.format,
    mimeType: recording.mimeType || `audio/${recording.format}`,
  };
};

export const voiceRecordingToDictationAudioInput = (
  recording: VoiceRecordingLike
): NativeBase64Audio | NativeFormDataFile =>
  voiceRecordingToNativeBase64Audio(recording) ?? voiceRecordingToNativeAudioFile(recording);

export const voiceRecordingToBrowserFile = (recording: VoiceRecordingLike): File => {
  if (!recording.data) {
    throw new Error('Voice recording did not include base64 audio data.');
  }

  const byteString = globalThis.atob(recording.data);
  const bytes = new Uint8Array(byteString.length);
  for (let index = 0; index < byteString.length; index += 1) {
    bytes[index] = byteString.charCodeAt(index);
  }

  const mediaType = recording.mimeType || `audio/${recording.format}`;
  const blob = new Blob([bytes], { type: mediaType });
  return new File([blob], recording.filename || `voice-recording.${recording.format}`, {
    type: mediaType,
  });
};

const getSpeechTextOptions = (options: SpeechTextChunkOptions = {}) => {
  const maxTextChars = Math.max(1, Math.floor(options.maxTextChars ?? MAX_SPEECH_TEXT_CHARS));
  const firstChunkChars = Math.max(1, Math.floor(options.firstChunkChars ?? 1_200));
  const chunkChars = Math.max(1, Math.floor(options.chunkChars ?? 2_400));
  const minBoundaryRatio = Math.min(1, Math.max(0, options.minBoundaryRatio ?? 0.6));
  return {
    chunkChars,
    firstChunkChars,
    maxTextChars,
    minBoundaryChars: Math.floor(maxTextChars * minBoundaryRatio),
  };
};

export const trimTextForSpeechGeneration = (
  text: string,
  options: SpeechTextChunkOptions = {}
): string => {
  const { maxTextChars, minBoundaryChars } = getSpeechTextOptions(options);
  const normalizedText = text.trim();
  if (normalizedText.length <= maxTextChars) {
    return normalizedText;
  }

  const clippedText = normalizedText.slice(0, maxTextChars);
  const sentenceBoundary = Math.max(
    clippedText.lastIndexOf('. '),
    clippedText.lastIndexOf('! '),
    clippedText.lastIndexOf('? '),
    clippedText.lastIndexOf('\n\n')
  );
  if (sentenceBoundary >= minBoundaryChars) {
    return clippedText.slice(0, sentenceBoundary + 1).trim();
  }

  const wordBoundary = clippedText.lastIndexOf(' ');
  if (wordBoundary >= minBoundaryChars) {
    return clippedText.slice(0, wordBoundary).trim();
  }

  return clippedText.trim();
};

export const getSpeechTextChunkBoundary = (text: string, maxLength: number): number => {
  const clippedText = text.slice(0, maxLength);
  const minimumBoundary = Math.floor(maxLength * 0.45);
  const paragraphBoundary = clippedText.lastIndexOf('\n\n');
  if (paragraphBoundary >= minimumBoundary) {
    return paragraphBoundary + 1;
  }

  const boundaryCandidates = [
    clippedText.lastIndexOf('. '),
    clippedText.lastIndexOf('! '),
    clippedText.lastIndexOf('? '),
    clippedText.lastIndexOf('; '),
  ];
  const sentenceBoundary = Math.max(...boundaryCandidates);
  if (sentenceBoundary >= minimumBoundary) {
    return sentenceBoundary + 1;
  }

  const wordBoundary = clippedText.lastIndexOf(' ');
  if (wordBoundary >= minimumBoundary) {
    return wordBoundary;
  }

  return maxLength;
};

export const splitTextForSpeechGeneration = (
  text: string,
  options: SpeechTextChunkOptions = {}
): string[] => {
  const { chunkChars, firstChunkChars } = getSpeechTextOptions(options);
  let remaining = trimTextForSpeechGeneration(text, options);
  const chunks: string[] = [];

  while (remaining) {
    const maxLength = chunks.length === 0 ? firstChunkChars : chunkChars;
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    const boundary = getSpeechTextChunkBoundary(remaining, maxLength);
    const chunk = remaining.slice(0, boundary).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    remaining = remaining.slice(boundary).trim();
  }

  return chunks;
};

export const transcribeDictationAudio = async (
  audio: VoiceAudioInput,
  options: VoiceGatewayRequestOptions = {}
): Promise<string> => {
  const fetchImpl = options.fetchImpl ?? fetch;

  if (isNativeBase64Audio(audio)) {
    const response = await fetchImpl(
      resolveVoiceMediaUrl(DICTATION_TRANSCRIBE_ENDPOINT, options.baseUrl),
      {
        method: 'POST',
        headers: mergeHeaders(jsonContentTypeHeaders, options.headers),
        body: JSON.stringify({
          audioBase64: audio.data,
          filename: getBase64AudioFilename(audio),
          mediaType: inferAudioMediaType(audio),
        }),
        ...definedProps({
          signal: options.signal,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(await buildDictationErrorMessage(response));
    }

    const payload = (await response.json()) as { text?: unknown };
    if (typeof payload.text !== 'string') {
      throw new Error('Dictation transcription returned an invalid response.');
    }

    return payload.text;
  }

  const formData = new FormData();
  appendDictationAudio(formData, audio);

  const response = await fetchImpl(
    resolveVoiceMediaUrl(DICTATION_TRANSCRIBE_ENDPOINT, options.baseUrl),
    {
      method: 'POST',
      body: formData,
      ...definedProps({
        headers: options.headers,
        signal: options.signal,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(await buildDictationErrorMessage(response));
  }

  const payload = (await response.json()) as { text?: unknown };
  if (typeof payload.text !== 'string') {
    throw new Error('Dictation transcription returned an invalid response.');
  }

  return payload.text;
};

export const generateSpeechAudio = async (
  text: string,
  options: VoiceGatewayRequestOptions = {}
): Promise<SpeechAudioResult> => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(
    resolveVoiceMediaUrl(SPEECH_GENERATE_ENDPOINT, options.baseUrl),
    {
      method: 'POST',
      headers: mergeHeaders(jsonContentTypeHeaders, options.headers),
      body: JSON.stringify({ text }),
      ...definedProps({ signal: options.signal }),
    }
  );

  if (!response.ok) {
    throw new Error(await buildSpeechErrorMessage(response));
  }

  const mediaType = response.headers.get('content-type')?.split(';')[0]?.trim() || 'audio/mpeg';
  const format = mediaType.includes('wav')
    ? 'wav'
    : mediaType.includes('mp4') || mediaType.includes('m4a')
      ? 'm4a'
      : 'mp3';
  const arrayBuffer = await response.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  if (bytes.byteLength <= 0) {
    throw new Error('Speech generation returned empty audio.');
  }

  return { bytes, mediaType, format };
};

export const generateSpeechAudioBlob = async (
  text: string,
  options: VoiceGatewayRequestOptions = {}
): Promise<Blob> => {
  const result = await generateSpeechAudio(text, options);
  const bytes = Uint8Array.from(result.bytes);
  return new Blob([bytes.buffer], { type: result.mediaType });
};
