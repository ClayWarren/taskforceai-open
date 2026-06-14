import { describe, expect, it, vi } from 'bun:test';

import {
  createArtifactPublicLink,
  deleteArtifact,
  fetchArtifact,
  fetchArtifactVersions,
  fetchArtifacts,
  fetchPublicArtifact,
  revokeArtifactPublicLinks,
  updateArtifactVisibility,
  type Artifact,
  type ArtifactVersion,
} from './artifacts';

vi.mock('@taskforceai/contracts/auth/csrf', () => ({
  getCsrfToken: vi.fn(async () => 'csrf-token'),
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
            artifact: artifact({ visibility: 'PUBLIC_LINK' }),
            version: artifactVersion(),
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
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ visibility: 'ORGANIZATION' }),
    });
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
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/v1/artifacts/artifact-1/share/public', {
      method: 'DELETE',
      credentials: 'include',
      headers: {
        'X-CSRF-Token': 'csrf-token',
      },
    });
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
      headers: {
        'X-CSRF-Token': 'csrf-token',
      },
    });
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
