import { describe, expect, it, vi } from 'bun:test';

import {
  createArtifactsClient,
  type ApiArtifact,
  type ApiArtifactVersion,
  type ArtifactRequest,
} from './artifacts';

const artifact = (overrides: Partial<ApiArtifact> = {}): ApiArtifact => ({
  id: 'artifact-1',
  ownerUserId: 12,
  type: 'SPREADSHEET',
  title: 'Budget.xlsx',
  status: 'READY',
  visibility: 'PRIVATE',
  createdAt: '2026-06-08T12:00:00Z',
  updatedAt: '2026-06-08T12:00:00Z',
  ...overrides,
});

const artifactVersion = (overrides: Partial<ApiArtifactVersion> = {}): ApiArtifactVersion => ({
  id: 'version-1',
  artifactId: 'artifact-1',
  version: 1,
  fileId: 'file-1',
  createdAt: '2026-06-08T12:00:00Z',
  ...overrides,
});

const publicArtifact = () => ({
  artifact: {
    id: 'artifact-1',
    type: 'SPREADSHEET',
    title: 'Budget.xlsx',
    status: 'READY',
    visibility: 'PUBLIC_LINK',
    createdAt: '2026-06-08T12:00:00Z',
    updatedAt: '2026-06-08T12:00:00Z',
  },
  version: {
    id: 'version-1',
    version: 1,
    filename: 'Budget.xlsx',
    bytes: 4096,
    createdAt: '2026-06-08T12:00:00Z',
  },
});

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const requestSequence = (...results: Array<Response | Error | string>) =>
  vi.fn(async () => {
    const next = results.shift();
    if (next instanceof Error || typeof next === 'string') throw next;
    if (!next) throw new Error('Unexpected artifact request');
    return next;
  });

describe('createArtifactsClient', () => {
  it('builds list queries with defaults and optional current versions', async () => {
    const request = requestSequence(jsonResponse([]), jsonResponse([]));
    const client = createArtifactsClient({ request });

    expect((await client.fetchArtifacts()).ok).toBe(true);
    expect(
      (await client.fetchArtifacts({ includeCurrentVersion: true, limit: 7, offset: 9 })).ok
    ).toBe(true);

    expect(request).toHaveBeenNthCalledWith(
      1,
      '/api/v1/artifacts?limit=50&offset=0',
      undefined,
      true
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      '/api/v1/artifacts?limit=7&offset=9&include=currentVersion',
      undefined,
      true
    );
  });

  it('loads every artifact page and stops on a later page error', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      artifact({ id: `artifact-${index + 1}` })
    );
    const request = requestSequence(jsonResponse(firstPage), jsonResponse([artifact()]));
    const client = createArtifactsClient({ request });

    const result = await client.fetchAllArtifacts({ includeCurrentVersion: true });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(101);
    expect(request).toHaveBeenNthCalledWith(
      1,
      '/api/v1/artifacts?limit=100&offset=0&include=currentVersion',
      undefined,
      true
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      '/api/v1/artifacts?limit=100&offset=100&include=currentVersion',
      undefined,
      true
    );

    const failedClient = createArtifactsClient({
      request: requestSequence(
        jsonResponse(firstPage),
        jsonResponse({ message: 'Artifact service unavailable' }, 503)
      ),
    });
    const failed = await failedClient.fetchAllArtifacts();
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.message).toBe('Artifact service unavailable');
  });

  it('executes every artifact operation with encoded paths and request metadata', async () => {
    const request = requestSequence(
      jsonResponse(artifact()),
      jsonResponse([artifactVersion()]),
      jsonResponse(artifact({ visibility: 'ORGANIZATION' })),
      jsonResponse({
        token: 'share-token',
        url: 'https://app.example.com/artifacts/share-token',
        artifact: artifact({ visibility: 'PUBLIC_LINK' }),
      }),
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
      jsonResponse(publicArtifact())
    );
    const client = createArtifactsClient({ request });

    expect((await client.fetchArtifact('artifact / one')).ok).toBe(true);
    expect((await client.fetchArtifactVersions('artifact / one')).ok).toBe(true);
    expect((await client.updateArtifactVisibility('artifact / one', 'ORGANIZATION')).ok).toBe(true);
    expect((await client.createArtifactPublicLink('artifact / one')).ok).toBe(true);
    expect((await client.revokeArtifactPublicLinks('artifact / one')).ok).toBe(true);
    expect((await client.deleteArtifact('artifact / one')).ok).toBe(true);
    expect((await client.fetchPublicArtifact('public token')).ok).toBe(true);

    const encoded = '/api/v1/artifacts/artifact%20%2F%20one';
    expect(request).toHaveBeenNthCalledWith(1, encoded, undefined, true);
    expect(request).toHaveBeenNthCalledWith(2, `${encoded}/versions`, undefined, true);
    expect(request).toHaveBeenNthCalledWith(
      3,
      encoded,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: 'ORGANIZATION' }),
      },
      true
    );
    expect(request).toHaveBeenNthCalledWith(4, `${encoded}/share/public`, { method: 'POST' }, true);
    expect(request).toHaveBeenNthCalledWith(
      5,
      `${encoded}/share/public`,
      { method: 'DELETE' },
      true
    );
    expect(request).toHaveBeenNthCalledWith(6, encoded, { method: 'DELETE' }, true);
    expect(request).toHaveBeenNthCalledWith(
      7,
      '/api/v1/artifacts/public/public%20token',
      undefined,
      false
    );
  });

  it('preserves validation, server, fallback, and thrown error behavior', async () => {
    const onInvalid = vi.fn();
    const onError = vi.fn();
    const request = requestSequence(
      jsonResponse([{ id: 'incomplete' }]),
      jsonResponse({ error: 'Artifact denied' }, 403),
      new Response('{', { status: 500, headers: { 'Content-Type': 'application/json' } }),
      new Error('network unavailable'),
      'offline'
    );
    const client = createArtifactsClient({ request, onError, onInvalid });

    const invalid = await client.fetchArtifacts();
    expect(invalid.ok).toBe(false);
    expect(onInvalid).toHaveBeenCalledWith('fetchArtifacts', expect.anything());

    const denied = await client.fetchArtifact('artifact-1');
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.message).toBe('Artifact denied');

    const fallback = await client.fetchArtifactVersions('artifact-1');
    expect(fallback.ok).toBe(false);
    if (!fallback.ok) expect(fallback.error.message).toBe('Failed to fetch artifact versions');

    const network = await client.updateArtifactVisibility('artifact-1', 'PRIVATE');
    expect(network.ok).toBe(false);
    if (!network.ok) expect(network.error.message).toBe('network unavailable');
    expect(onError).toHaveBeenNthCalledWith(1, 'Failed to update artifact visibility', {
      artifactId: 'artifact-1',
      visibility: 'PRIVATE',
      error: expect.any(Error),
    });

    const nonError = await client.deleteArtifact('artifact-1');
    expect(nonError.ok).toBe(false);
    if (!nonError.ok) expect(nonError.error.message).toBe('offline');
    expect(onError).toHaveBeenNthCalledWith(2, 'Failed to delete artifact', {
      artifactId: 'artifact-1',
      error: 'offline',
    });
  });

  it('accepts an explicitly typed request adapter', async () => {
    const request: ArtifactRequest = async (_path, _init, authenticated) => {
      expect(authenticated).toBe(true);
      return jsonResponse([]);
    };
    const result = await createArtifactsClient({ request }).fetchArtifacts();
    expect(result.ok).toBe(true);
  });
});
