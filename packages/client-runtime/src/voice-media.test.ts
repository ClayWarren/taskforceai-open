import { describe, expect, it, vi } from 'bun:test';

import {
  DICTATION_TRANSCRIBE_ENDPOINT,
  generateSpeechAudio,
  generateSpeechAudioBlob,
  getSpeechTextChunkBoundary,
  MAX_SPEECH_TEXT_CHARS,
  resolveVoiceMediaUrl,
  SPEECH_GENERATE_ENDPOINT,
  splitTextForSpeechGeneration,
  transcribeDictationAudio,
  trimTextForSpeechGeneration,
  voiceRecordingToBrowserFile,
  voiceRecordingToDictationAudioInput,
  voiceRecordingToNativeBase64Audio,
  voiceRecordingToNativeAudioFile,
} from './voice-media';

describe('voice media client', () => {
  it('resolves voice media URLs against an optional base URL', () => {
    expect(resolveVoiceMediaUrl(DICTATION_TRANSCRIBE_ENDPOINT)).toBe(DICTATION_TRANSCRIBE_ENDPOINT);
    expect(resolveVoiceMediaUrl(DICTATION_TRANSCRIBE_ENDPOINT, '   ')).toBe(
      DICTATION_TRANSCRIBE_ENDPOINT
    );
    expect(resolveVoiceMediaUrl(SPEECH_GENERATE_ENDPOINT, 'https://www.taskforceai.chat')).toBe(
      'https://www.taskforceai.chat/api/speech/generate'
    );
  });

  it('transcribes dictation audio through the shared endpoint contract', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(
        new Response(JSON.stringify({ text: 'shared transcript' }), {
          headers: { 'content-type': 'application/json' },
        })
      )
    );

    const text = await transcribeDictationAudio(new Blob(['audio'], { type: 'audio/webm' }), {
      baseUrl: 'https://www.taskforceai.chat',
      fetchImpl: fetchMock as unknown as typeof fetch,
      headers: { authorization: 'Bearer token' },
    });

    expect(text).toBe('shared transcript');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.taskforceai.chat/api/dictation/transcribe',
      expect.objectContaining({
        method: 'POST',
        headers: { authorization: 'Bearer token' },
      })
    );
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBeInstanceOf(FormData);
  });

  it('appends native dictation audio files without coercing them to a Blob', async () => {
    const originalFormData = globalThis.FormData;
    const nativeAudioFile = {
      uri: 'file:///tmp/voice-recording.m4a',
      name: 'voice-recording.m4a',
      type: 'audio/mp4',
    };
    class CapturingFormData {
      static instances: CapturingFormData[] = [];
      readonly fields: Array<[string, unknown]> = [];

      constructor() {
        CapturingFormData.instances.push(this);
      }

      append(name: string, value: unknown) {
        this.fields.push([name, value]);
      }
    }
    globalThis.FormData = CapturingFormData as unknown as typeof FormData;

    try {
      const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
        Promise.resolve(
          new Response(JSON.stringify({ text: 'native transcript' }), {
            headers: { 'content-type': 'application/json' },
          })
        )
      );

      await expect(
        transcribeDictationAudio(nativeAudioFile, {
          fetchImpl: fetchMock as unknown as typeof fetch,
        })
      ).resolves.toBe('native transcript');

      expect(CapturingFormData.instances[0]?.fields).toEqual([['audio', nativeAudioFile]]);
    } finally {
      globalThis.FormData = originalFormData;
    }
  });

  it('sends native base64 dictation audio as JSON to avoid React Native multipart parts', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(
        new Response(JSON.stringify({ text: 'native transcript' }), {
          headers: { 'content-type': 'application/json' },
        })
      )
    );

    await expect(
      transcribeDictationAudio(
        {
          data: 'YXVkaW8=',
          filename: 'voice-recording.m4a',
          format: 'm4a',
          mimeType: 'audio/mp4',
        },
        {
          fetchImpl: fetchMock as unknown as typeof fetch,
          headers: { authorization: 'Bearer token' },
        }
      )
    ).resolves.toBe('native transcript');

    const request = fetchMock.mock.calls[0]?.[1];
    expect(request?.headers).toBeInstanceOf(Headers);
    const headers = request?.headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer token');
    expect(headers.get('content-type')).toBe('application/json');
    expect(request?.body).toBe(
      JSON.stringify({
        audioBase64: 'YXVkaW8=',
        filename: 'voice-recording.m4a',
        mediaType: 'audio/mp4',
      })
    );
  });

  it('infers native base64 dictation audio metadata for JSON uploads', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({ text: 'native transcript' })))
    );

    const cases = [
      [
        { data: 'YXVkaW8=', filename: 'clip.bin', mediaType: 'audio/custom' },
        { filename: 'clip.bin', mediaType: 'audio/custom' },
      ],
      [
        { data: 'YXVkaW8=', format: '.mp3' },
        { filename: 'voice-recording.mp3', mediaType: 'audio/mpeg' },
      ],
      [
        { data: 'YXVkaW8=', format: 'wav' },
        { filename: 'voice-recording.wav', mediaType: 'audio/wav' },
      ],
      [
        { data: 'YXVkaW8=', format: '3gp' },
        { filename: 'voice-recording.3gp', mediaType: 'audio/3gpp' },
      ],
      [{ data: 'YXVkaW8=' }, { filename: 'voice-recording.m4a', mediaType: 'audio/mp4' }],
    ] as const;

    for (const [audio, expected] of cases) {
      await expect(
        transcribeDictationAudio(audio, {
          fetchImpl: fetchMock as unknown as typeof fetch,
        })
      ).resolves.toBe('native transcript');
      const request = fetchMock.mock.calls.at(-1)?.[1];
      expect(JSON.parse(String(request?.body))).toEqual({
        audioBase64: 'YXVkaW8=',
        ...expected,
      });
    }
  });

  it('converts voice recordings to the preferred dictation audio input', () => {
    expect(voiceRecordingToNativeBase64Audio({ format: 'm4a' })).toBeNull();
    expect(
      voiceRecordingToDictationAudioInput({
        data: 'YXVkaW8=',
        filename: 'voice-recording.m4a',
        format: 'm4a',
        mimeType: 'audio/mp4',
        uri: 'file:///tmp/voice-recording.m4a',
      })
    ).toEqual({
      data: 'YXVkaW8=',
      filename: 'voice-recording.m4a',
      format: 'm4a',
      mimeType: 'audio/mp4',
    });

    expect(
      voiceRecordingToNativeAudioFile({
        filename: 'voice-recording.m4a',
        format: 'm4a',
        mimeType: 'audio/mp4',
        uri: 'file:///tmp/voice-recording.m4a',
      })
    ).toEqual({
      name: 'voice-recording.m4a',
      type: 'audio/mp4',
      uri: 'file:///tmp/voice-recording.m4a',
    });

    expect(() => voiceRecordingToNativeAudioFile({ format: 'm4a' })).toThrow(
      'Voice recording did not include a native audio file.'
    );
  });

  it('converts voice recordings to browser files', async () => {
    const file = voiceRecordingToBrowserFile({
      data: 'YXVkaW8=',
      filename: 'voice-recording.wav',
      format: 'wav',
      mimeType: 'audio/wav',
    });

    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('voice-recording.wav');
    expect(file.type).toBe('audio/wav');
    expect(await file.text()).toBe('audio');
    expect(() => voiceRecordingToBrowserFile({ format: 'wav' })).toThrow(
      'Voice recording did not include base64 audio data.'
    );
  });

  it('trims and chunks generated speech text at natural boundaries', () => {
    const firstChunk = 'First chunk sentence. '.repeat(6).trim();
    const secondChunk = 'Second chunk sentence. '.repeat(10).trim();

    expect(
      splitTextForSpeechGeneration(`${firstChunk}\n\n${secondChunk}`, {
        firstChunkChars: 180,
        chunkChars: 2_400,
      })
    ).toEqual([firstChunk, secondChunk]);

    expect(
      trimTextForSpeechGeneration(`${'Short sentence. '.repeat(8)}Trailing words`, {
        maxTextChars: 80,
        minBoundaryRatio: 0.2,
      })
    ).toBe('Short sentence. Short sentence. Short sentence. Short sentence. Short sentence.');
    expect(getSpeechTextChunkBoundary('alpha beta. gamma delta', 20)).toBe('alpha beta.'.length);
    expect(getSpeechTextChunkBoundary('alpha beta gamma delta', 16)).toBe('alpha beta'.length);

    const longText = `${'word '.repeat(Math.ceil(MAX_SPEECH_TEXT_CHARS / 5) + 40)}done`;
    const trimmedText = trimTextForSpeechGeneration(longText);
    expect(trimmedText.length).toBeLessThanOrEqual(MAX_SPEECH_TEXT_CHARS);
    expect(trimmedText.startsWith('word ')).toBe(true);
  });

  it('generates speech audio through the shared endpoint contract', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(
        new Response(bytes, {
          headers: { 'content-type': 'audio/mpeg' },
        })
      )
    );

    const result = await generateSpeechAudio('read this', {
      fetchImpl: fetchMock as unknown as typeof fetch,
      headers: { authorization: 'Bearer token' },
    });

    expect(Array.from(result.bytes)).toEqual([1, 2, 3]);
    expect(result.mediaType).toBe('audio/mpeg');
    expect(result.format).toBe('mp3');
    const request = fetchMock.mock.calls[0]?.[1];
    expect(request).toBeDefined();
    const requestHeaders = request?.headers;
    expect(requestHeaders).toBeInstanceOf(Headers);
    const headers = requestHeaders as Headers;
    expect(headers.get('authorization')).toBe('Bearer token');
    expect(headers.get('content-type')).toBe('application/json');
    expect(request?.body).toBe(JSON.stringify({ text: 'read this' }));
  });

  it('surfaces gateway error messages', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(
        new Response(JSON.stringify({ error: 'Dictation failed upstream' }), { status: 502 })
      )
    );

    await expect(
      transcribeDictationAudio(new Blob(['audio']), {
        fetchImpl: fetchMock as unknown as typeof fetch,
      })
    ).rejects.toThrow('Dictation failed upstream');

    const speechFetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(
        new Response(JSON.stringify({ error: 'Speech failed upstream' }), { status: 502 })
      )
    );

    await expect(
      generateSpeechAudio('read this', {
        fetchImpl: speechFetchMock as unknown as typeof fetch,
      })
    ).rejects.toThrow('Speech failed upstream');
  });

  it('uses sign-in wording for unauthenticated voice media requests', async () => {
    const dictationFetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(
        new Response(JSON.stringify({ error: 'Authentication required' }), { status: 401 })
      )
    );

    await expect(
      transcribeDictationAudio(new Blob(['audio']), {
        fetchImpl: dictationFetchMock as unknown as typeof fetch,
      })
    ).rejects.toThrow('Sign in to use dictation.');

    const speechFetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(
        new Response(JSON.stringify({ error: 'Authentication required' }), { status: 401 })
      )
    );

    await expect(
      generateSpeechAudio('read this', {
        fetchImpl: speechFetchMock as unknown as typeof fetch,
      })
    ).rejects.toThrow('Sign in to listen to responses.');
  });

  it('uses deployment-specific fallback messages when voice media is unavailable', async () => {
    const dictationFetchMock = vi.fn(() =>
      Promise.resolve(new Response('not-json', { status: 503 }))
    );

    await expect(
      transcribeDictationAudio(new Blob(['audio']), {
        fetchImpl: dictationFetchMock as unknown as typeof fetch,
      })
    ).rejects.toThrow('Dictation is not configured for this deployment.');

    const speechFetchMock = vi.fn(() => Promise.resolve(new Response('not-json', { status: 503 })));

    await expect(
      generateSpeechAudio('read this', {
        fetchImpl: speechFetchMock as unknown as typeof fetch,
      })
    ).rejects.toThrow('Speech generation is not configured for this deployment.');
  });

  it('falls back to status-based voice media errors when error payloads are invalid', async () => {
    const dictationFetchMock = vi.fn(() =>
      Promise.resolve(new Response('not-json', { status: 500 }))
    );

    await expect(
      transcribeDictationAudio(new Blob(['audio']), {
        fetchImpl: dictationFetchMock as unknown as typeof fetch,
      })
    ).rejects.toThrow('Failed to transcribe dictation: 500');

    const speechFetchMock = vi.fn(() => Promise.resolve(new Response('not-json', { status: 502 })));

    await expect(
      generateSpeechAudio('read this', {
        fetchImpl: speechFetchMock as unknown as typeof fetch,
      })
    ).rejects.toThrow('Failed to generate speech: 502');
  });

  it('rejects invalid dictation responses and empty speech audio', async () => {
    const dictationFetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({}))));

    await expect(
      transcribeDictationAudio(new Blob(['audio']), {
        fetchImpl: dictationFetchMock as unknown as typeof fetch,
      })
    ).rejects.toThrow('Dictation transcription returned an invalid response.');

    const base64DictationErrorMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ error: 'Base64 failed' }), { status: 502 }))
    );
    await expect(
      transcribeDictationAudio(
        { data: 'YXVkaW8=', format: 'm4a' },
        { fetchImpl: base64DictationErrorMock as unknown as typeof fetch }
      )
    ).rejects.toThrow('Base64 failed');

    const invalidBase64DictationMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({})))
    );
    await expect(
      transcribeDictationAudio(
        { data: 'YXVkaW8=', format: 'm4a' },
        { fetchImpl: invalidBase64DictationMock as unknown as typeof fetch }
      )
    ).rejects.toThrow('Dictation transcription returned an invalid response.');

    const speechFetchMock = vi.fn(() =>
      Promise.resolve(new Response(new Uint8Array(), { headers: { 'content-type': 'audio/wav' } }))
    );

    await expect(
      generateSpeechAudio('read this', {
        fetchImpl: speechFetchMock as unknown as typeof fetch,
      })
    ).rejects.toThrow('Speech generation returned empty audio.');
  });

  it('maps speech media types and exposes generated speech as a blob', async () => {
    const wavFetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(new Uint8Array([1]), {
          headers: { 'content-type': 'audio/wav; charset=binary' },
        })
      )
    );
    const m4aFetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(new Uint8Array([2]), {
          headers: { 'content-type': 'audio/mp4' },
        })
      )
    );
    const defaultFetchMock = vi.fn(() => Promise.resolve(new Response(new Uint8Array([3]))));

    await expect(
      generateSpeechAudio('read wav', { fetchImpl: wavFetchMock as unknown as typeof fetch })
    ).resolves.toMatchObject({ format: 'wav', mediaType: 'audio/wav' });
    await expect(
      generateSpeechAudio('read m4a', { fetchImpl: m4aFetchMock as unknown as typeof fetch })
    ).resolves.toMatchObject({ format: 'm4a', mediaType: 'audio/mp4' });

    const blob = await generateSpeechAudioBlob('read default', {
      fetchImpl: defaultFetchMock as unknown as typeof fetch,
    });

    expect(blob.type).toBe('audio/mpeg');
    expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual([3]);
  });
});
