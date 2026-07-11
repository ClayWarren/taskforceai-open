import { describe, expect, it, vi } from 'bun:test';

import {
  createArtifactPublicLink,
  deleteArtifact,
  fetchArtifact,
  fetchArtifactVersions,
  fetchAllArtifacts,
  fetchArtifacts,
  fetchPublicArtifact,
  revokeArtifactPublicLinks,
  updateArtifactVisibility,
  type Artifact,
  type ArtifactVersion,
} from './artifacts';

vi.mock('@taskforceai/api-client/auth/csrf', () => ({
  getCsrfToken: vi.fn(async () => 'csrf-token'),
}));

vi.mock('../logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

const artifact = (overrides: Partial<Artifact> = {}): Artifact => ({
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

const artifactVersion = (overrides: Partial<ArtifactVersion> = {}): ArtifactVersion => ({
  id: 'version-1',
  artifactId: 'artifact-1',
  version: 1,
  fileId: 'file-1',
  createdAt: '2026-06-08T12:00:00Z',
  ...overrides,
});

describe('artifacts API', () => {
  it('can request current versions with the artifact list', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([artifact({ currentVersion: artifactVersion() })]),
    });
    (global as any).fetch = fetchMock;

    const result = await fetchArtifacts({ includeCurrentVersion: true });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/artifacts?limit=50&offset=0&include=currentVersion',
      {
        credentials: 'include',
      }
    );
  });

  it('loads every artifact page until the API returns a partial page', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      artifact({ id: `artifact-${index + 1}` })
    );
    const secondPage = [artifact({ id: 'artifact-101' })];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(firstPage) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(secondPage) });
    (global as any).fetch = fetchMock;

    const result = await fetchAllArtifacts({ includeCurrentVersion: true });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(101);
    }
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/artifacts?limit=100&offset=0&include=currentVersion',
      { credentials: 'include' }
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/artifacts?limit=100&offset=100&include=currentVersion',
      { credentials: 'include' }
    );
  });

  it('stops artifact pagination when a later page fails', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      artifact({ id: `artifact-${index + 1}` })
    );
    (global as any).fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(firstPage) })
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ message: 'Artifact service unavailable' }),
      });

    const result = await fetchAllArtifacts();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Artifact service unavailable');
    }
  });

  it('returns validation errors for malformed artifact lists', async () => {
    (global as any).fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{ id: 'artifact-1' }]),
    });

    const result = await fetchArtifacts();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Invalid response from server');
    }
  });

  it('returns validation errors for malformed public artifact payloads', async () => {
    (global as any).fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
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
          },
        }),
    });

    const result = await fetchPublicArtifact('public token');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Invalid response from server');
    }
  });

  it('fetches artifacts, versions, visibility updates, and public artifacts with encoded ids', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(artifact()) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([artifactVersion()]) })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(artifact({ visibility: 'ORGANIZATION' })),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
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
              mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              filename: 'Budget.xlsx',
              bytes: 4096,
              createdAt: '2026-06-08T12:00:00Z',
            },
          }),
      });
    (global as any).fetch = fetchMock;

    expect((await fetchArtifact('artifact / one')).ok).toBe(true);
    expect((await fetchArtifactVersions('artifact / one')).ok).toBe(true);
    const visibilityResult = await updateArtifactVisibility('artifact / one', 'ORGANIZATION');
    expect(visibilityResult.ok).toBe(true);
    expect((await fetchPublicArtifact('public token')).ok).toBe(true);

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/v1/artifacts/artifact%20%2F%20one', {
      credentials: 'include',
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/artifacts/artifact%20%2F%20one/versions',
      {
        credentials: 'include',
      }
    );
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/v1/artifacts/artifact%20%2F%20one', {
      method: 'PATCH',
      credentials: 'include',
      headers: expect.any(Headers),
      body: JSON.stringify({ visibility: 'ORGANIZATION' }),
    });
    const updateHeaders = new Headers(fetchMock.mock.calls[2]?.[1]?.headers);
    expect(updateHeaders.get('Content-Type')).toBe('application/json');
    expect(updateHeaders.get('X-CSRF-Token')).toBe('csrf-token');
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/v1/artifacts/public/public%20token');
  });

  it('creates and revokes public artifact links', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            token: 'share-token',
            url: 'https://app.example.com/artifacts/share-token',
            artifact: artifact({ visibility: 'PUBLIC_LINK' }),
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 204,
      });
    (global as any).fetch = fetchMock;

    const createResult = await createArtifactPublicLink('artifact-1');
    const revokeResult = await revokeArtifactPublicLinks('artifact-1');

    expect(createResult.ok).toBe(true);
    expect(revokeResult.ok).toBe(true);
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/v1/artifacts/artifact-1/share/public', {
      method: 'POST',
      credentials: 'include',
      headers: expect.any(Headers),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/v1/artifacts/artifact-1/share/public', {
      method: 'DELETE',
      credentials: 'include',
      headers: expect.any(Headers),
    });
    const createHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    const revokeHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers);
    expect(createHeaders.get('X-CSRF-Token')).toBe('csrf-token');
    expect(revokeHeaders.get('X-CSRF-Token')).toBe('csrf-token');
  });

  it('returns API and network errors from artifact endpoints', async () => {
    (global as any).fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ message: 'Missing artifact' }),
      })
      .mockRejectedValueOnce('offline');

    const missing = await fetchArtifact('missing');
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error.message).toBe('Missing artifact');
    }

    const offline = await fetchArtifactVersions('artifact-1');
    expect(offline.ok).toBe(false);
    if (!offline.ok) {
      expect(offline.error.message).toBe('offline');
    }
  });

  it('returns fallback errors when artifact endpoints fail without server messages', async () => {
    const fetchMock = vi.fn();
    for (let index = 0; index < 6; index += 1) {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      });
    }
    (global as any).fetch = fetchMock;

    const list = await fetchArtifacts();
    const versions = await fetchArtifactVersions('artifact-1');
    const update = await updateArtifactVisibility('artifact-1', 'ORGANIZATION');
    const createLink = await createArtifactPublicLink('artifact-1');
    const revokeLinks = await revokeArtifactPublicLinks('artifact-1');
    const publicArtifact = await fetchPublicArtifact('public-token');

    expect(list.ok).toBe(false);
    if (!list.ok) expect(list.error.message).toBe('Failed to fetch artifacts');
    expect(versions.ok).toBe(false);
    if (!versions.ok) expect(versions.error.message).toBe('Failed to fetch artifact versions');
    expect(update.ok).toBe(false);
    if (!update.ok) expect(update.error.message).toBe('Failed to update artifact');
    expect(createLink.ok).toBe(false);
    if (!createLink.ok) expect(createLink.error.message).toBe('Failed to create public link');
    expect(revokeLinks.ok).toBe(false);
    if (!revokeLinks.ok) expect(revokeLinks.error.message).toBe('Failed to revoke public links');
    expect(publicArtifact.ok).toBe(false);
    if (!publicArtifact.ok)
      expect(publicArtifact.error.message).toBe('Failed to fetch public artifact');
  });

  it('returns thrown errors from artifact mutation and public fetch helpers', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('visibility offline'))
      .mockRejectedValueOnce(new Error('share offline'))
      .mockRejectedValueOnce(new Error('revoke offline'))
      .mockRejectedValueOnce(new Error('delete offline'))
      .mockRejectedValueOnce(new Error('public offline'));
    (global as any).fetch = fetchMock;

    const update = await updateArtifactVisibility('artifact-1', 'PRIVATE');
    const createLink = await createArtifactPublicLink('artifact-1');
    const revokeLinks = await revokeArtifactPublicLinks('artifact-1');
    const deleted = await deleteArtifact('artifact-1');
    const publicArtifact = await fetchPublicArtifact('public-token');

    expect(update.ok).toBe(false);
    if (!update.ok) expect(update.error.message).toBe('visibility offline');
    expect(createLink.ok).toBe(false);
    if (!createLink.ok) expect(createLink.error.message).toBe('share offline');
    expect(revokeLinks.ok).toBe(false);
    if (!revokeLinks.ok) expect(revokeLinks.error.message).toBe('revoke offline');
    expect(deleted.ok).toBe(false);
    if (!deleted.ok) expect(deleted.error.message).toBe('delete offline');
    expect(publicArtifact.ok).toBe(false);
    if (!publicArtifact.ok) expect(publicArtifact.error.message).toBe('public offline');
  });

  it('deletes an artifact with credentials and CSRF protection', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
    });
    (global as any).fetch = fetchMock;

    const result = await deleteArtifact('artifact-1');

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/artifacts/artifact-1', {
      method: 'DELETE',
      credentials: 'include',
      headers: expect.any(Headers),
    });
    const deleteHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(deleteHeaders.get('X-CSRF-Token')).toBe('csrf-token');
  });

  it('returns server errors from artifact deletion', async () => {
    (global as any).fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ detail: 'Delete failed' }),
    });

    const result = await deleteArtifact('artifact-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Failed to delete artifact');
    }
  });
});
