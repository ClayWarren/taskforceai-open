import { describe, expect, it, vi } from 'bun:test';

import {
  createClient,
  createMockResponse,
  formDataField,
  installFetchMock,
  installFetchResponses,
  requestFromCall,
} from '../test/index-test-helpers';

describe('TaskForceAI file methods', () => {
  it('uses authenticated server upload flow for files larger than 4MB', async () => {
    const fetchMock = installFetchResponses(
      createMockResponse({
        id: 'file_456',
        filename: 'big.pdf',
        purpose: 'assistants',
        bytes: 5000000,
        created_at: 1_767_225_600,
        mime_type: 'application/pdf',
      })
    );

    const client = createClient({ apiKey: 'test-api-key' });

    const largeBlob = new Blob([new Uint8Array(4 * 1024 * 1024 + 1)], {
      type: 'application/pdf',
    });
    const result = await client.uploadFile('big.pdf', largeBlob);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const request = requestFromCall(fetchMock.mock.calls[0]);
    expect(request.url).toBe('https://example.com/api/v1/developer/files');
    expect(request.headers.get('x-api-key')).toBe('test-api-key');
    const formData = await request.formData();
    expect(formDataField(formData, 'purpose')).toBe('assistants');
    expect(formDataField(formData, 'mime_type')).toBe('application/pdf');
    expect(formDataField(formData, 'file')).toBeInstanceOf(File);
    expect(result.id).toBe('file_456');

    const failFetchMock = installFetchResponses(new Response(null, { status: 500 }));
    await expect(client.uploadFile('big.pdf', largeBlob)).rejects.toThrow(
      'Failed to upload file: 500'
    );
    expect(failFetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses x-api-key auth and configured fields for small uploads', async () => {
    const fetchMock = installFetchResponses(
      createMockResponse({
        id: 'file_123',
        filename: 'report.txt',
        purpose: 'assistants',
        bytes: 5,
        created_at: 1_767_225_600,
      }),
      createMockResponse({
        id: 'file_789',
        filename: 'report.json',
        purpose: 'analysis',
        bytes: 2,
        created_at: 1_767_225_600,
      })
    );
    const client = createClient({ apiKey: 'test-api-key' });

    await client.uploadFile('report.txt', new Blob(['hello']));
    const request = requestFromCall(fetchMock.mock.calls[0]);
    expect(request.url).toBe('https://example.com/api/v1/developer/files');
    expect(request.headers.get('x-api-key')).toBe('test-api-key');
    expect(request.headers.get('authorization')).toBeNull();
    const formData = await request.formData();
    expect(formDataField(formData, 'purpose')).toBe('assistants');
    expect(formDataField(formData, 'mime_type')).toBe('application/octet-stream');
    expect(formDataField(formData, 'file')).toBeInstanceOf(File);

    await client.uploadFile('report.json', new Blob(['{}'], { type: 'application/json' }), {
      purpose: 'analysis',
      mime_type: 'application/custom+json',
    });
    const customFormData = await requestFromCall(fetchMock.mock.calls[1]).formData();
    expect(formDataField(customFormData, 'purpose')).toBe('analysis');
    expect(formDataField(customFormData, 'mime_type')).toBe('application/custom+json');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses x-api-key auth header for downloadFile requests', async () => {
    const payload = new Uint8Array([1, 2, 3]).buffer;
    const fetchMock = installFetchResponses(new Response(payload, { status: 200 }));

    const client = createClient({ apiKey: 'test-api-key' });

    const result = await client.downloadFile('file_123');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requestFromCall(fetchMock.mock.calls[0]);
    expect(request.url).toBe('https://example.com/api/v1/developer/files/file_123/content');
    expect(request.headers.get('x-api-key')).toBe('test-api-key');
    expect(request.headers.get('authorization')).toBeNull();
    expect(Array.from(new Uint8Array(result))).toEqual(Array.from(new Uint8Array(payload)));
  });

  it('retries retryable download responses before returning content', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const payload = new Uint8Array([4, 5, 6]).buffer;
    const fetchMock = installFetchResponses(
      createMockResponse(
        { error: 'temporarily unavailable' },
        { status: 503, headers: { 'retry-after': '0' } }
      ),
      new Response(payload, { status: 200 })
    );

    const result = await createClient({ apiKey: 'test-api-key' }).downloadFile('file_retry');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(Array.from(new Uint8Array(result))).toEqual(Array.from(new Uint8Array(payload)));
  });

  it('applies configured timeouts to upload and download requests', async () => {
    vi.useRealTimers();
    const fetchMock = installFetchMock(
      vi.fn((_url: unknown, init?: RequestInit) => {
        const signal = init?.signal as AbortSignal | undefined;
        return new Promise<Response>((_resolve, reject) => {
          const abort = () => {
            const error = new Error('Aborted');
            error.name = 'AbortError';
            reject(error);
          };
          if (signal?.aborted) {
            abort();
            return;
          }
          signal?.addEventListener('abort', abort, { once: true });
        });
      })
    );
    const client = createClient({ apiKey: 'test-api-key', timeout: 20 });

    await expect(client.uploadFile('slow.txt', new Blob(['hello']))).rejects.toThrow(/timeout/i);
    await expect(client.downloadFile('slow-file')).rejects.toThrow(/timeout/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws upload and download errors with HTTP status context', async () => {
    installFetchResponses(
      new Response(null, { status: 413 }),
      new Response(new ArrayBuffer(0), { status: 404 }),
      new Response('not-json', { status: 200 })
    );

    const client = createClient({ apiKey: 'test-api-key' });

    await expect(client.uploadFile('report.txt', new Blob(['hello']))).rejects.toThrow(
      'Failed to upload file: 413'
    );
    await expect(client.downloadFile('missing')).rejects.toThrow('Failed to download file: 404');
    await expect(client.uploadFile('bad-response.txt', new Blob(['hello']))).rejects.toMatchObject({
      message: 'Invalid upload response from server',
      statusCode: 200,
    });
  });

  it('validates file identifiers and filenames before issuing requests', async () => {
    const fetchMock = installFetchMock();
    const client = createClient({ apiKey: 'test-api-key' });

    await expect(client.uploadFile('', new Blob(['hello']))).rejects.toThrow(
      'Filename must be a non-empty string'
    );
    await expect(client.getFile('')).rejects.toThrow('File ID must be a non-empty string');
    await expect(client.deleteFile('  ')).rejects.toThrow('File ID must be a non-empty string');
    await expect(client.downloadFile('')).rejects.toThrow('File ID must be a non-empty string');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
