import { describe, expect, it, vi } from 'bun:test';

import {
  arrayBufferToBase64,
  base64ToUint8Array,
  buildRealtimeVoiceSessionConfig,
  fetchRealtimeVoiceSetup,
  getGatewayRealtimeProtocols,
  getBase64DecodedByteLength,
  mergeBase64Uint8ArrayChunks,
  normalizeFloat32AudioBufferToBase64,
  normalizePcm16AudioBufferToBase64,
  normalizeRealtimeAudioBufferToBase64,
  parseRealtimeVoiceServerEvent,
  pcm16Base64ToWavBytes,
  REALTIME_INPUT_SAMPLE_RATE,
  REALTIME_OUTPUT_SAMPLE_RATE,
  REALTIME_SETUP_ENDPOINT,
  serializeRealtimeVoiceEvent,
} from './realtime-voice';

describe('realtime voice client', () => {
  it('builds Gateway realtime auth subprotocols', () => {
    expect(getGatewayRealtimeProtocols('vcst_token')).toEqual([
      'ai-gateway-realtime.v1',
      'ai-gateway-auth.vcst_token',
    ]);
    expect(getGatewayRealtimeProtocols('vcst_token', { teamId: 'team_123' })).toEqual([
      'ai-gateway-realtime.v1',
      'ai-gateway-auth.vcst_token',
      'ai-gateway-team.dGVhbV8xMjM',
    ]);
  });

  it('builds a mobile-friendly realtime session config', () => {
    expect(buildRealtimeVoiceSessionConfig({ instructions: 'Be brief.' })).toEqual(
      expect.objectContaining({
        instructions: 'Be brief.',
        inputAudioFormat: { type: 'audio/pcm', rate: REALTIME_INPUT_SAMPLE_RATE },
        outputAudioFormat: { type: 'audio/pcm', rate: REALTIME_OUTPUT_SAMPLE_RATE },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        outputModalities: ['audio'],
        turnDetection: { type: 'server-vad' },
      })
    );
  });

  it('fetches realtime setup through the shared endpoint contract', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            token: 'vcst_token',
            url: 'wss://gateway.vercel.test/realtime',
            tools: [],
          }),
          { headers: { 'content-type': 'application/json' } }
        )
      )
    );
    const sessionConfig = buildRealtimeVoiceSessionConfig();

    const result = await fetchRealtimeVoiceSetup({
      baseUrl: 'https://www.taskforceai.chat',
      fetchImpl: fetchMock as unknown as typeof fetch,
      headers: { authorization: 'Bearer token' },
      sessionConfig,
    });

    expect(result).toEqual({
      token: 'vcst_token',
      url: 'wss://gateway.vercel.test/realtime',
      tools: [],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.taskforceai.chat/api/realtime/setup',
      expect.objectContaining({
        method: 'POST',
      })
    );
    const request = fetchMock.mock.calls[0]?.[1];
    expect(request).toBeDefined();
    if (!request) {
      throw new Error('Expected realtime setup request options.');
    }
    expect(request.headers).toBeInstanceOf(Headers);
    const headers = request.headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer token');
    expect(headers.get('content-type')).toBe('application/json');
    expect(request.body).toBe(JSON.stringify({ sessionConfig }));
  });

  it('surfaces realtime setup errors', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(
        new Response(JSON.stringify({ error: 'Realtime unavailable' }), { status: 403 })
      )
    );

    await expect(
      fetchRealtimeVoiceSetup({
        fetchImpl: fetchMock as unknown as typeof fetch,
      })
    ).rejects.toThrow('Realtime unavailable');
  });

  it('uses status-specific realtime setup fallback errors when the error payload is invalid', async () => {
    const responses = [
      new Response('{', { status: 401 }),
      new Response('{', { status: 403 }),
      new Response('{', { status: 503 }),
      new Response('{', { status: 429 }),
    ];
    const fetchMock = vi.fn(() => Promise.resolve(responses.shift()!));

    await expect(
      fetchRealtimeVoiceSetup({ fetchImpl: fetchMock as unknown as typeof fetch })
    ).rejects.toThrow('Sign in to use realtime voice.');
    await expect(
      fetchRealtimeVoiceSetup({ fetchImpl: fetchMock as unknown as typeof fetch })
    ).rejects.toThrow('Realtime voice is not available for this account.');
    await expect(
      fetchRealtimeVoiceSetup({ fetchImpl: fetchMock as unknown as typeof fetch })
    ).rejects.toThrow('Realtime voice is not configured for this deployment.');
    await expect(
      fetchRealtimeVoiceSetup({ fetchImpl: fetchMock as unknown as typeof fetch })
    ).rejects.toThrow('Failed to fetch realtime setup: 429');
  });

  it('rejects invalid realtime setup success payloads', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ token: 'vcst_token' })))
    );

    await expect(
      fetchRealtimeVoiceSetup({ fetchImpl: fetchMock as unknown as typeof fetch })
    ).rejects.toThrow('Realtime setup returned an invalid response.');
  });

  it('parses realtime server events from string and binary message payloads', async () => {
    await expect(parseRealtimeVoiceServerEvent('{"type":"session-created"}')).resolves.toEqual({
      type: 'session-created',
    });

    await expect(
      parseRealtimeVoiceServerEvent(new TextEncoder().encode('{"type":"audio-done","itemId":"1"}'))
    ).resolves.toEqual({
      type: 'audio-done',
      itemId: '1',
    });
    await expect(
      parseRealtimeVoiceServerEvent(
        new TextEncoder().encode('{"type":"text-done","itemId":"2"}').buffer
      )
    ).resolves.toEqual({
      type: 'text-done',
      itemId: '2',
    });
    await expect(
      parseRealtimeVoiceServerEvent(
        new Blob(['{"type":"response-done","responseId":"r1","status":"completed"}'])
      )
    ).resolves.toEqual({
      type: 'response-done',
      responseId: 'r1',
      status: 'completed',
    });

    await expect(parseRealtimeVoiceServerEvent('not-json')).resolves.toBeNull();
    await expect(parseRealtimeVoiceServerEvent({})).resolves.toBeNull();
  });

  it('encodes PCM buffers and wraps PCM16 output in a WAV container', () => {
    const pcm = new Uint8Array([0x01, 0x00, 0xff, 0x7f]);
    const base64 = arrayBufferToBase64(pcm.buffer);
    expect(base64).toBe('AQD/fw==');
    expect(Array.from(base64ToUint8Array(base64))).toEqual([0x01, 0x00, 0xff, 0x7f]);
    expect(Array.from(base64ToUint8Array('   \n  '))).toEqual([]);

    const wav = pcm16Base64ToWavBytes(base64, { sampleRate: 24000, channels: 1 });
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe('WAVE');
    expect(String.fromCharCode(...wav.slice(36, 40))).toBe('data');
    expect(Array.from(wav.slice(44))).toEqual([0x01, 0x00, 0xff, 0x7f]);
  });

  it('reports base64 decoded lengths and merges realtime audio chunks', () => {
    expect(getBase64DecodedByteLength('')).toBe(0);
    expect(getBase64DecodedByteLength('AQD/fw==')).toBe(4);
    expect(getBase64DecodedByteLength(' YQ= \n')).toBe(1);
    expect(Array.from(mergeBase64Uint8ArrayChunks(['AQI=', 'AwQ=']))).toEqual([1, 2, 3, 4]);
  });

  it('normalizes captured PCM16 buffers into the realtime input format', () => {
    const source = new ArrayBuffer(8);
    const sourceView = new DataView(source);
    sourceView.setInt16(0, 0, true);
    sourceView.setInt16(2, 1000, true);
    sourceView.setInt16(4, 2000, true);
    sourceView.setInt16(6, 3000, true);

    const base64 = normalizePcm16AudioBufferToBase64(source, {
      inputSampleRate: REALTIME_INPUT_SAMPLE_RATE * 2,
      outputSampleRate: REALTIME_INPUT_SAMPLE_RATE,
    });
    const bytes = base64ToUint8Array(base64);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    expect(bytes.byteLength).toBe(4);
    expect(view.getInt16(0, true)).toBe(0);
    expect(view.getInt16(2, true)).toBe(2000);
  });

  it('downmixes multi-channel PCM16 buffers before sending realtime audio', () => {
    const source = new ArrayBuffer(8);
    const sourceView = new DataView(source);
    sourceView.setInt16(0, 1000, true);
    sourceView.setInt16(2, 3000, true);
    sourceView.setInt16(4, -1000, true);
    sourceView.setInt16(6, 1000, true);

    const base64 = normalizePcm16AudioBufferToBase64(source, {
      inputChannels: 2,
      inputSampleRate: REALTIME_INPUT_SAMPLE_RATE,
      outputSampleRate: REALTIME_INPUT_SAMPLE_RATE,
    });
    const bytes = base64ToUint8Array(base64);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    expect(bytes.byteLength).toBe(4);
    expect(view.getInt16(0, true)).toBe(2000);
    expect(view.getInt16(2, true)).toBe(0);
  });

  it('handles PCM16 typed-array views and empty or invalid realtime audio inputs', () => {
    const bytes = new Uint8Array([0xff, 0xff, 0x34, 0x12, 0xee]);
    const pcmView = bytes.subarray(2, 4);

    expect(
      normalizePcm16AudioBufferToBase64(pcmView, {
        inputSampleRate: REALTIME_INPUT_SAMPLE_RATE,
        outputSampleRate: REALTIME_INPUT_SAMPLE_RATE,
      })
    ).toBe('NBI=');
    expect(
      normalizePcm16AudioBufferToBase64(pcmView, {
        inputSampleRate: 0,
        outputSampleRate: REALTIME_INPUT_SAMPLE_RATE,
      })
    ).toBe(arrayBufferToBase64(pcmView));
    expect(
      normalizePcm16AudioBufferToBase64(new ArrayBuffer(0), {
        inputSampleRate: REALTIME_INPUT_SAMPLE_RATE,
      })
    ).toBe('');
    expect(
      normalizeFloat32AudioBufferToBase64(new ArrayBuffer(4), {
        inputSampleRate: 0,
        outputSampleRate: REALTIME_INPUT_SAMPLE_RATE,
      })
    ).toBe('');
    expect(
      normalizeFloat32AudioBufferToBase64(new ArrayBuffer(0), {
        inputSampleRate: REALTIME_INPUT_SAMPLE_RATE,
      })
    ).toBe('');
  });

  it('normalizes captured Float32 buffers into the realtime input format', () => {
    const source = new ArrayBuffer(16);
    const sourceView = new DataView(source);
    sourceView.setFloat32(0, 0, true);
    sourceView.setFloat32(4, 0.5, true);
    sourceView.setFloat32(8, -0.5, true);
    sourceView.setFloat32(12, 1, true);

    const base64 = normalizeFloat32AudioBufferToBase64(source, {
      inputSampleRate: REALTIME_INPUT_SAMPLE_RATE * 2,
      outputSampleRate: REALTIME_INPUT_SAMPLE_RATE,
    });
    const bytes = base64ToUint8Array(base64);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    expect(bytes.byteLength).toBe(4);
    expect(view.getInt16(0, true)).toBe(0);
    expect(view.getInt16(2, true)).toBe(-16384);
  });

  it('selects the realtime audio normalizer by captured encoding', () => {
    const pcm = new ArrayBuffer(2);
    new DataView(pcm).setInt16(0, 1234, true);
    expect(
      normalizeRealtimeAudioBufferToBase64(pcm, {
        inputEncoding: 'pcm16',
        inputSampleRate: REALTIME_INPUT_SAMPLE_RATE,
      })
    ).toBe(normalizePcm16AudioBufferToBase64(pcm, { inputSampleRate: REALTIME_INPUT_SAMPLE_RATE }));

    const float = new ArrayBuffer(4);
    new DataView(float).setFloat32(0, 0.25, true);
    expect(
      normalizeRealtimeAudioBufferToBase64(float, {
        inputEncoding: 'float32',
        inputSampleRate: REALTIME_INPUT_SAMPLE_RATE,
      })
    ).toBe(
      normalizeFloat32AudioBufferToBase64(float, { inputSampleRate: REALTIME_INPUT_SAMPLE_RATE })
    );
  });

  it('exposes the realtime setup endpoint constant', () => {
    expect(REALTIME_SETUP_ENDPOINT).toBe('/api/realtime/setup');
  });

  it('serializes realtime client events', () => {
    expect(serializeRealtimeVoiceEvent({ type: 'input-audio-commit' })).toBe(
      '{"type":"input-audio-commit"}'
    );
  });
});
