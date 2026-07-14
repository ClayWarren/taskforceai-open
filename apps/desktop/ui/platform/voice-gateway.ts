'use client';

import {
  arrayBufferToBase64,
  base64ToUint8Array,
  DICTATION_TRANSCRIBE_ENDPOINT,
  REALTIME_SETUP_ENDPOINT,
  SPEECH_GENERATE_ENDPOINT,
  type VoiceGatewayRequestOptions,
} from '@taskforceai/client-runtime';
import { getStoredToken } from '@taskforceai/api-client/auth/auth-storage';
import { getCsrfToken } from '@taskforceai/api-client/auth/csrf';
import { getRuntimeEnv } from '@taskforceai/config/app-env';

import type { PlatformRuntime } from '@taskforceai/web/app/lib/platform/platform-interfaces';
import {
  generateDesktopAppServerVoiceSpeech,
  setupDesktopAppServerRealtimeVoice,
  transcribeDesktopAppServerVoice,
} from './app-server';

const PRODUCTION_VOICE_GATEWAY_URL = 'https://www.taskforceai.chat';
const VOICE_GATEWAY_BASE_URL_ENV = 'VITE_VOICE_GATEWAY_BASE_URL';
const VOICE_ENDPOINTS = new Set([
  DICTATION_TRANSCRIBE_ENDPOINT,
  REALTIME_SETUP_ENDPOINT,
  SPEECH_GENERATE_ENDPOINT,
]);

export const getDesktopVoiceGatewayBaseUrl = (): string => {
  const configuredUrl = getRuntimeEnv(VOICE_GATEWAY_BASE_URL_ENV)?.trim();
  return configuredUrl || PRODUCTION_VOICE_GATEWAY_URL;
};

const endpointPathname = (input: RequestInfo | URL): string | null => {
  try {
    const rawUrl = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    const url = new URL(rawUrl, getDesktopVoiceGatewayBaseUrl());
    return VOICE_ENDPOINTS.has(url.pathname) ? url.pathname : null;
  } catch {
    return null;
  }
};

const jsonResponse = (payload: unknown, init: ResponseInit = {}): Response => {
  const headers = new Headers(init.headers);
  headers.set('cache-control', 'private, no-store');
  return Response.json(payload, {
    ...init,
    headers,
  });
};

const errorResponse = (error: unknown): Response => {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  const status = lower.includes('sign in') ? 401 : lower.includes('rate limit') ? 429 : 502;
  return jsonResponse({ error: message }, { status });
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readJsonBody = async (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Record<string, unknown>> => {
  if (init?.body === undefined && input instanceof Request) {
    const payload = await input.clone().json();
    return isRecord(payload) ? payload : {};
  }

  const body = init?.body;
  if (body === undefined || body === null) {
    return {};
  }
  if (typeof body === 'string') {
    const payload = JSON.parse(body);
    return isRecord(payload) ? payload : {};
  }
  if (body instanceof Blob) {
    const payload = JSON.parse(await body.text());
    return isRecord(payload) ? payload : {};
  }
  return {};
};

const readDictationParams = async (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<{
  audioBase64: string;
  fileName: string;
  mediaType: string;
}> => {
  const body = init?.body;
  const formData =
    body instanceof FormData
      ? body
      : input instanceof Request
        ? await input.clone().formData()
        : null;
  const audio = formData?.get('audio');
  if (!(audio instanceof Blob)) {
    throw new Error('Audio file is required');
  }

  const fileName = audio instanceof File ? audio.name : 'dictation.webm';
  return {
    audioBase64: arrayBufferToBase64(await audio.arrayBuffer()),
    fileName,
    mediaType: audio.type || 'audio/webm',
  };
};

const arrayBufferFromBytes = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
};

const desktopVoiceGatewayFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const pathname = endpointPathname(input);
  if (!pathname) {
    return errorResponse(new Error('Unsupported desktop voice gateway endpoint'));
  }

  try {
    if (pathname === DICTATION_TRANSCRIBE_ENDPOINT) {
      const result = await transcribeDesktopAppServerVoice(await readDictationParams(input, init));
      return jsonResponse({ text: result.text });
    }

    if (pathname === SPEECH_GENERATE_ENDPOINT) {
      const payload = await readJsonBody(input, init);
      const result = await generateDesktopAppServerVoiceSpeech({
        text: typeof payload['text'] === 'string' ? payload['text'] : '',
      });
      const bytes = base64ToUint8Array(result.audioBase64);
      return new Response(arrayBufferFromBytes(bytes), {
        headers: {
          'cache-control': 'private, no-store',
          'content-type': result.mediaType,
          'x-taskforceai-audio-format': result.format ?? 'mp3',
        },
      });
    }

    const payload = await readJsonBody(input, init);
    const result = await setupDesktopAppServerRealtimeVoice({
      sessionConfig: payload['sessionConfig'],
    });
    return jsonResponse({
      token: result.token,
      url: result.url,
      expiresAt: result.expiresAt,
      tools: Array.isArray(result.tools) ? result.tools : [],
    });
  } catch (error) {
    return errorResponse(error);
  }
}) as typeof fetch;

export const createDesktopVoiceGatewayRequestOptions =
  async (): Promise<VoiceGatewayRequestOptions> => ({
    fetchImpl: desktopVoiceGatewayFetch,
  });

export const createBrowserVoiceGatewayRequestOptions =
  async (): Promise<VoiceGatewayRequestOptions> => {
    const csrfToken = await getCsrfToken();
    const token = getStoredToken();
    if (!csrfToken && !token.ok) {
      return {};
    }

    const headers = new Headers();
    if (csrfToken) {
      headers.set('X-CSRF-Token', csrfToken);
    }
    if (token.ok) {
      headers.set('authorization', `Bearer ${token.value}`);
    }
    return { headers };
  };

export const createVoiceGatewayRequestOptions = async (
  runtime: PlatformRuntime
): Promise<VoiceGatewayRequestOptions> =>
  runtime === 'desktop'
    ? createDesktopVoiceGatewayRequestOptions()
    : createBrowserVoiceGatewayRequestOptions();
