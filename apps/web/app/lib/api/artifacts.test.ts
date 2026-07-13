import { describe, expect, it, vi } from 'bun:test';

import {
  fetchArtifact,
  fetchArtifacts,
  fetchPublicArtifact,
  updateArtifactVisibility,
  type Artifact,
} from './artifacts';
import { logger } from '../logger';

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

describe('web artifact API composition', () => {
  it('uses cookie credentials for authenticated reads', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([artifact()]),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    expect((await fetchArtifacts()).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/artifacts?limit=50&offset=0', {
      credentials: 'include',
    });
  });

  it('adds JSON and CSRF headers to authenticated mutations', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(artifact({ visibility: 'ORGANIZATION' })),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    expect((await updateArtifactVisibility('artifact / one', 'ORGANIZATION')).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/artifacts/artifact%20%2F%20one', {
      method: 'PATCH',
      credentials: 'include',
      headers: expect.any(Headers),
      body: JSON.stringify({ visibility: 'ORGANIZATION' }),
    });
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('X-CSRF-Token')).toBe('csrf-token');
  });

  it('keeps public artifact reads unauthenticated', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          artifact: artifact({ visibility: 'PUBLIC_LINK' }),
          version: {
            id: 'version-1',
            version: 1,
            filename: 'Budget.xlsx',
            createdAt: '2026-06-08T12:00:00Z',
          },
        }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    expect((await fetchPublicArtifact('public token')).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/artifacts/public/public%20token');
  });

  it('wires validation and request failures through the web logger callbacks', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([{ id: 'incomplete' }]),
      })
      .mockRejectedValueOnce(new Error('network unavailable')) as unknown as typeof fetch;

    const invalid = await fetchArtifacts();
    const failed = await fetchArtifact('artifact-1');

    expect(invalid.ok).toBe(false);
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.message).toBe('network unavailable');
    expect(logger.warn).toHaveBeenCalledWith(
      'Artifact API response validation failed',
      expect.objectContaining({ error: expect.any(Object) })
    );
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to fetch artifact',
      expect.objectContaining({ artifactId: 'artifact-1', error: expect.any(Error) })
    );
  });
});
