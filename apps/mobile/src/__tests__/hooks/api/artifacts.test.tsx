import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { waitFor } from '@testing-library/react-native';

import {
  createMobileArtifactPublicLink,
  deleteMobileArtifact,
  fetchArtifactContentBytes,
  fetchArtifactContentText,
  getArtifactFileContentUrl,
  getArtifactMetadataDownloadUrl,
  type MobileArtifact,
  useArtifactsQuery,
} from '../../../hooks/api/artifacts';
import { renderHookWithQueryClient } from '../../helpers/query-client';

const mockPinnedFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
const mockGetSession = jest.fn();

jest.mock('../../../api/client', () => ({
  getMobilePinnedFetch: () => mockPinnedFetch,
}));

jest.mock('../../../config/base-url', () => ({
  getMobileBaseUrl: () => 'https://mobile.example/',
}));

jest.mock('../../../logger', () => ({
  createModuleLogger: () => ({ error: jest.fn(), warn: jest.fn() }),
  mobileLogger: { error: jest.fn(), warn: jest.fn() },
}));

jest.mock('../../../storage/sqlite-adapter', () => ({
  sqliteStorage: {
    getSession: () => mockGetSession(),
  },
}));

const artifactFixture = (overrides: Partial<MobileArtifact> = {}): MobileArtifact => ({
  id: 'artifact-1',
  ownerUserId: 123,
  type: 'DOCUMENT',
  title: 'Research brief',
  status: 'READY',
  visibility: 'PRIVATE',
  createdAt: '2026-06-19T00:00:00.000Z',
  updatedAt: '2026-06-19T00:00:00.000Z',
  currentVersion: {
    id: 'version-1',
    artifactId: 'artifact-1',
    version: 1,
    fileId: 'file 1',
    mimeType: 'text/plain',
    filename: 'brief.txt',
    bytes: 12,
    createdAt: '2026-06-19T00:00:00.000Z',
  },
  ...overrides,
});

const jsonResponse = (body: unknown, init: ResponseInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers,
  });
};

describe('mobile artifact API helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSession.mockResolvedValue({ ok: true, value: { accessToken: 'mobile-token' } });
  });

  it('loads artifacts through React Query with auth headers and current-version include', async () => {
    const artifact = artifactFixture();
    mockPinnedFetch.mockResolvedValueOnce(jsonResponse([artifact]));

    const { result, queryClient } = renderHookWithQueryClient(() => useArtifactsQuery(true));

    await waitFor(() => expect(result.current.data).toEqual([artifact]));
    expect(queryClient.getQueryData(['artifacts'])).toEqual([artifact]);
    expect(mockPinnedFetch).toHaveBeenCalledWith(
      'https://mobile.example/api/v1/artifacts?limit=50&offset=0&include=currentVersion',
      expect.objectContaining({ headers: expect.any(Headers) })
    );
    const fetchCall = mockPinnedFetch.mock.calls[0] as [RequestInfo | URL, RequestInit];
    const headers = fetchCall[1].headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer mobile-token');
    expect(headers.get('User-Agent')).toBe('TaskForceAI-Mobile');
  });

  it('keeps the artifacts query disabled until enabled', async () => {
    const { result } = renderHookWithQueryClient(() => useArtifactsQuery(false));

    expect(result.current.fetchStatus).toBe('idle');
    expect(mockPinnedFetch).not.toHaveBeenCalled();
  });

  it('surfaces fetch and validation failures through the artifacts query', async () => {
    mockPinnedFetch.mockResolvedValueOnce(jsonResponse({ error: 'invalid session' }, { status: 401 }));
    const failed = renderHookWithQueryClient(() => useArtifactsQuery(true));

    await waitFor(() => expect(failed.result.current.error).toEqual(new Error('invalid session')));

    mockPinnedFetch.mockResolvedValueOnce(jsonResponse([{ id: 1 }]));
    const invalid = renderHookWithQueryClient(() => useArtifactsQuery(true));

    await waitFor(() => expect(invalid.result.current.error).toEqual(new Error('Invalid response from server')));
  });

  it('derives safe metadata and file content URLs', () => {
    expect(
      getArtifactMetadataDownloadUrl(artifactFixture({ metadata: { downloadUrl: 'https://cdn.example/a' } }))
    ).toBe('https://cdn.example/a');
    expect(
      getArtifactMetadataDownloadUrl(artifactFixture({ metadata: { downloadUrl: 'javascript:alert(1)' } }))
    ).toBeNull();
    expect(getArtifactMetadataDownloadUrl(artifactFixture({ metadata: null }))).toBeNull();

    expect(getArtifactFileContentUrl({ ...artifactFixture().currentVersion!, fileId: 'file/with space' })).toBe(
      'https://mobile.example/api/v1/developer/files/file%2Fwith%20space/content?disposition=attachment'
    );
    expect(getArtifactFileContentUrl(null)).toBeNull();
  });

  it('downloads artifact bytes and maps failed downloads to API errors', async () => {
    mockPinnedFetch.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));

    const downloaded = await fetchArtifactContentBytes('https://mobile.example/file');

    expect(downloaded.ok).toBe(true);
    if (downloaded.ok) {
      expect(Array.from(downloaded.value)).toEqual([1, 2, 3]);
    }

    mockPinnedFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'download denied' }), { status: 403 })
    );

    const failed = await fetchArtifactContentBytes('https://mobile.example/file');

    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.error.message).toBe('download denied');
    }
  });

  it('loads text previews and handles malformed error bodies', async () => {
    mockPinnedFetch.mockResolvedValueOnce(new Response('preview text'));

    const loaded = await fetchArtifactContentText('https://mobile.example/preview');

    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.value).toBe('preview text');
    }

    mockPinnedFetch.mockResolvedValueOnce(new Response('not-json', { status: 500 }));

    const failed = await fetchArtifactContentText('https://mobile.example/preview');

    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.error.message).toBe('Failed to load artifact preview');
    }
  });

  it('creates public links and validates the share response', async () => {
    const artifact = artifactFixture({ visibility: 'PUBLIC_LINK' });
    mockPinnedFetch.mockResolvedValueOnce(jsonResponse({ token: 'share-token', url: 'https://share.example/a', artifact }));

    const created = await createMobileArtifactPublicLink('artifact/1');

    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.value.token).toBe('share-token');
    }
    expect(mockPinnedFetch).toHaveBeenCalledWith(
      'https://mobile.example/api/v1/artifacts/artifact%2F1/share/public',
      expect.objectContaining({ method: 'POST' })
    );

    mockPinnedFetch.mockResolvedValueOnce(jsonResponse({ token: 'missing-url' }));

    const invalid = await createMobileArtifactPublicLink('artifact-1');

    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.error.message).toBe('Invalid response from server');
    }
  });

  it('deletes artifacts and reads delete error payloads', async () => {
    mockPinnedFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const deleted = await deleteMobileArtifact('artifact/1');

    expect(deleted.ok).toBe(true);
    expect(mockPinnedFetch).toHaveBeenCalledWith(
      'https://mobile.example/api/v1/artifacts/artifact%2F1',
      expect.objectContaining({ method: 'DELETE' })
    );

    mockPinnedFetch.mockResolvedValueOnce(jsonResponse({ error: 'delete denied' }, { status: 403 }));

    const failed = await deleteMobileArtifact('artifact-1');

    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.error.message).toBe('delete denied');
    }
  });
});
