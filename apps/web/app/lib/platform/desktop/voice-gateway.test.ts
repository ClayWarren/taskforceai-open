import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../../tests/setup/dom';

const getCsrfTokenMock = vi.fn();
const getStoredTokenMock = vi.fn();

vi.mock('@taskforceai/api-client/auth/auth-storage', () => ({
  getStoredToken: getStoredTokenMock,
}));

vi.mock('@taskforceai/api-client/auth/csrf', () => ({
  getCsrfToken: getCsrfTokenMock,
}));

const loadModule = async () => import('./voice-gateway');

describe('desktop voice gateway client', () => {
  const originalOverride = process.env['VITE_VOICE_GATEWAY_BASE_URL'];
  const originalTauriDescriptor = Object.getOwnPropertyDescriptor(window, '__TAURI__');
  const tauriInvokeMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['VITE_VOICE_GATEWAY_BASE_URL'];
    getCsrfTokenMock.mockResolvedValue('browser-csrf-token');
    getStoredTokenMock.mockReturnValue({ ok: true, value: 'browser-token' });
    tauriInvokeMock.mockImplementation(async (command: string) => {
      if (command === 'app_server_auth_status') {
        return {
          authenticated: true,
        };
      }
      if (command === 'app_server_voice_transcribe') {
        return { text: 'desktop dictation' };
      }
      if (command === 'app_server_voice_speech_generate') {
        return {
          audioBase64: 'AQID',
          mediaType: 'audio/mpeg',
          format: 'mp3',
        };
      }
      if (command === 'app_server_voice_realtime_setup') {
        return {
          token: 'desktop-realtime-token',
          url: 'wss://gateway.example/realtime',
          expiresAt: 123,
          tools: [],
        };
      }
      return undefined;
    });
    Object.defineProperty(window, '__TAURI__', {
      configurable: true,
      value: {
        invoke: tauriInvokeMock,
      },
    });
  });

  afterEach(() => {
    if (originalOverride === undefined) {
      delete process.env['VITE_VOICE_GATEWAY_BASE_URL'];
    } else {
      process.env['VITE_VOICE_GATEWAY_BASE_URL'] = originalOverride;
    }
    if (originalTauriDescriptor) {
      Object.defineProperty(window, '__TAURI__', originalTauriDescriptor);
    } else {
      Reflect.deleteProperty(window, '__TAURI__');
    }
  });

  it('routes desktop voice media through app-server commands without exposing bearer auth', async () => {
    const { createDesktopVoiceGatewayRequestOptions } = await loadModule();

    const options = await createDesktopVoiceGatewayRequestOptions();

    expect(options.baseUrl).toBeUndefined();
    expect(options.headers).toBeUndefined();
    expect(options.fetchImpl).toBeFunction();
    expect(tauriInvokeMock).not.toHaveBeenCalledWith('app_server_auth_status');

    const dictation = new FormData();
    dictation.set('audio', new File(['audio'], 'dictation.webm', { type: 'audio/webm' }));
    const dictationResponse = await options.fetchImpl?.('/api/dictation/transcribe', {
      method: 'POST',
      body: dictation,
    });
    expect(await dictationResponse?.json()).toEqual({ text: 'desktop dictation' });

    const speechResponse = await options.fetchImpl?.('/api/speech/generate', {
      method: 'POST',
      body: JSON.stringify({ text: 'read this' }),
    });
    expect(speechResponse?.headers.get('authorization')).toBeNull();
    expect(speechResponse?.headers.get('content-type')).toBe('audio/mpeg');
    expect(await speechResponse?.arrayBuffer()).toEqual(new Uint8Array([1, 2, 3]).buffer);

    const realtimeResponse = await options.fetchImpl?.('/api/realtime/setup', {
      method: 'POST',
      body: JSON.stringify({ sessionConfig: { outputModalities: ['audio'] } }),
    });
    expect(await realtimeResponse?.json()).toEqual({
      expiresAt: 123,
      token: 'desktop-realtime-token',
      tools: [],
      url: 'wss://gateway.example/realtime',
    });

    expect(tauriInvokeMock).toHaveBeenCalledWith('app_server_voice_transcribe', {
      params: {
        audioBase64: 'YXVkaW8=',
        fileName: 'dictation.webm',
        mediaType: 'audio/webm',
      },
    });
    expect(tauriInvokeMock).toHaveBeenCalledWith('app_server_voice_speech_generate', {
      params: { text: 'read this' },
    });
    expect(tauriInvokeMock).toHaveBeenCalledWith('app_server_voice_realtime_setup', {
      params: { sessionConfig: { outputModalities: ['audio'] } },
    });
  });

  it('supports a configured voice gateway base URL', async () => {
    process.env['VITE_VOICE_GATEWAY_BASE_URL'] = 'http://127.0.0.1:3210';
    const { getDesktopVoiceGatewayBaseUrl } = await loadModule();

    expect(getDesktopVoiceGatewayBaseUrl()).toBe('http://127.0.0.1:3210');
  });

  it('adds auth and csrf headers for browser same-origin voice routes', async () => {
    const { createVoiceGatewayRequestOptions } = await loadModule();

    const options = await createVoiceGatewayRequestOptions('browser');
    const headers = new Headers(options.headers);

    expect(options.baseUrl).toBeUndefined();
    expect(headers.get('X-CSRF-Token')).toBe('browser-csrf-token');
    expect(headers.get('authorization')).toBe('Bearer browser-token');
    expect(getCsrfTokenMock).toHaveBeenCalledTimes(1);
    expect(getStoredTokenMock).toHaveBeenCalledTimes(1);
    expect(tauriInvokeMock).not.toHaveBeenCalled();
  });

  it('uses browser bearer auth when csrf token is unavailable', async () => {
    getCsrfTokenMock.mockResolvedValueOnce('');
    const { createVoiceGatewayRequestOptions } = await loadModule();

    const options = await createVoiceGatewayRequestOptions('browser');
    const headers = new Headers(options.headers);

    expect(headers.get('authorization')).toBe('Bearer browser-token');
    expect(headers.get('X-CSRF-Token')).toBeNull();
    expect(tauriInvokeMock).not.toHaveBeenCalled();
  });

  it('leaves browser voice headers empty when auth and csrf are unavailable', async () => {
    getCsrfTokenMock.mockResolvedValueOnce('');
    getStoredTokenMock.mockReturnValueOnce({ ok: false, error: 'NOT_FOUND' });
    const { createVoiceGatewayRequestOptions } = await loadModule();

    await expect(createVoiceGatewayRequestOptions('browser')).resolves.toEqual({});
  });
});
