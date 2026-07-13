import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../tests/setup/dom';

import type { Artifact, ArtifactVersion } from '../lib/api/artifacts';

const useParamsMock = vi.fn(() => ({ artifactId: 'artifact-1' }));
const fetchArtifactMock = vi.fn();
const fetchArtifactVersionsMock = vi.fn();
const createArtifactPublicLinkMock = vi.fn();
const revokeArtifactPublicLinksMock = vi.fn();
const updateArtifactVisibilityMock = vi.fn();
const clipboardWriteMock = vi.fn(async () => undefined);
let authState = { isAuthenticated: true, isLoading: false };

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    options: config,
    useParams: useParamsMock,
  }),
  Link: ({ children, to, ...props }: any) => (
    <a href={String(to ?? '#')} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('../lib/providers/AuthProvider', () => ({
  useAuth: () => authState,
}));

vi.mock('../lib/api/artifacts', () => ({
  fetchArtifact: fetchArtifactMock,
  fetchArtifactVersions: fetchArtifactVersionsMock,
  createArtifactPublicLink: createArtifactPublicLinkMock,
  revokeArtifactPublicLinks: revokeArtifactPublicLinksMock,
  updateArtifactVisibility: updateArtifactVisibilityMock,
}));

const version = (overrides: Partial<ArtifactVersion> = {}): ArtifactVersion => ({
  id: 'version-1',
  artifactId: 'artifact-1',
  version: 1,
  fileId: 'file-1',
  mimeType: 'image/png',
  filename: 'chart.png',
  bytes: 2048,
  createdAt: '2026-06-12T12:00:00Z',
  ...overrides,
});

const artifact = (overrides: Partial<Artifact> = {}): Artifact => ({
  id: 'artifact-1',
  ownerUserId: 12,
  type: 'IMAGE',
  title: 'Quarterly chart',
  status: 'READY',
  visibility: 'PRIVATE',
  currentVersionId: 'version-1',
  createdAt: '2026-06-12T12:00:00Z',
  updatedAt: '2026-06-12T12:00:00Z',
  ...overrides,
});

const { Route } = await import('./artifacts.$artifactId');
const ArtifactPage = Route.options.component!;

describe('ArtifactPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState = { isAuthenticated: true, isLoading: false };
    useParamsMock.mockReturnValue({ artifactId: 'artifact-1' });
    fetchArtifactMock.mockResolvedValue({ ok: true, value: artifact() });
    fetchArtifactVersionsMock.mockResolvedValue({ ok: true, value: [version()] });
    createArtifactPublicLinkMock.mockResolvedValue({
      ok: true,
      value: {
        token: 'public-token',
        url: 'https://taskforceai.chat/artifacts/public/public-token',
        artifact: artifact({ visibility: 'PUBLIC_LINK' }),
      },
    });
    revokeArtifactPublicLinksMock.mockResolvedValue({ ok: true });
    updateArtifactVisibilityMock.mockResolvedValue({
      ok: true,
      value: artifact({ visibility: 'ORGANIZATION' }),
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWriteMock },
    });
  });

  afterEach(() => cleanup());

  it('loads an artifact detail view and creates a copyable public link', async () => {
    render(<ArtifactPage />);

    await waitFor(() => expect(screen.getByText('Quarterly chart')).toBeInTheDocument());
    expect(fetchArtifactMock).toHaveBeenCalledWith('artifact-1');
    expect(fetchArtifactVersionsMock).toHaveBeenCalledWith('artifact-1');
    expect(screen.getByAltText('Quarterly chart')).toHaveAttribute(
      'src',
      '/api/v1/developer/files/file-1/content?disposition=inline'
    );
    expect(screen.getByText('v1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Public' }));

    await waitFor(() => expect(createArtifactPublicLinkMock).toHaveBeenCalledWith('artifact-1'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy artifact URL' }));

    await waitFor(() =>
      expect(clipboardWriteMock).toHaveBeenCalledWith(
        'https://taskforceai.chat/artifacts/public/public-token'
      )
    );
    expect(screen.getByText('Copied')).toBeInTheDocument();
  });

  it('shows an auth gate without fetching when the user is signed out', async () => {
    authState = { isAuthenticated: false, isLoading: false };

    render(<ArtifactPage />);

    expect(await screen.findByText('Sign in to view this artifact')).toBeInTheDocument();
    expect(fetchArtifactMock).not.toHaveBeenCalled();
    expect(fetchArtifactVersionsMock).not.toHaveBeenCalled();
  });

  it('shows the artifact fetch error when the artifact cannot be loaded', async () => {
    fetchArtifactMock.mockResolvedValue({ ok: false, error: new Error('Artifact missing') });

    render(<ArtifactPage />);

    expect(await screen.findByText('Artifact missing')).toBeInTheDocument();
    expect(screen.queryByText('Quarterly chart')).not.toBeInTheDocument();
  });

  it('renders video previews with the current version URL', async () => {
    fetchArtifactMock.mockResolvedValue({ ok: true, value: artifact({ type: 'VIDEO' }) });
    fetchArtifactVersionsMock.mockResolvedValue({
      ok: true,
      value: [version({ mimeType: 'video/mp4', filename: 'clip.mp4' })],
    });
    render(<ArtifactPage />);

    const video = (await screen.findByLabelText('Quarterly chart')) as HTMLVideoElement;
    expect(video.tagName).toBe('VIDEO');
    expect(video).toHaveAttribute(
      'src',
      '/api/v1/developer/files/file-1/content?disposition=inline'
    );
  });

  it('shows a download fallback when the current version cannot be previewed inline', async () => {
    fetchArtifactMock.mockResolvedValue({ ok: true, value: artifact({ type: 'DOCUMENT' }) });
    fetchArtifactVersionsMock.mockResolvedValue({
      ok: true,
      value: [version({ mimeType: 'application/octet-stream', filename: 'archive.bin' })],
    });

    render(<ArtifactPage />);

    expect(
      await screen.findByText('Preview unavailable for this artifact type')
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download current file' })).toHaveAttribute(
      'href',
      '/api/v1/developer/files/file-1/content?disposition=attachment'
    );
  });

  it('updates workspace visibility and copies the artifact URL', async () => {
    render(<ArtifactPage />);

    await screen.findByText('Quarterly chart');
    fireEvent.click(screen.getByRole('button', { name: 'Workspace' }));

    await waitFor(() =>
      expect(updateArtifactVisibilityMock).toHaveBeenCalledWith('artifact-1', 'ORGANIZATION')
    );
    expect(screen.getByText('ORGANIZATION')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Copy artifact URL' }));

    await waitFor(() => {
      expect(clipboardWriteMock).toHaveBeenCalledWith('http://localhost/');
    });
  });

  it('revokes public links when switching a public artifact back to private', async () => {
    fetchArtifactMock.mockResolvedValue({
      ok: true,
      value: artifact({ visibility: 'PUBLIC_LINK' }),
    });

    render(<ArtifactPage />);

    await screen.findByText('Quarterly chart');
    fireEvent.click(screen.getByRole('button', { name: 'Private' }));

    await waitFor(() => expect(revokeArtifactPublicLinksMock).toHaveBeenCalledWith('artifact-1'));
    expect(updateArtifactVisibilityMock).not.toHaveBeenCalled();
    expect(screen.getByText('PRIVATE')).toBeInTheDocument();
  });

  it('surfaces version and visibility action failures without losing the artifact', async () => {
    fetchArtifactVersionsMock.mockResolvedValue({
      ok: false,
      error: new Error('Versions unavailable'),
    });
    updateArtifactVisibilityMock.mockResolvedValue({
      ok: false,
      error: new Error('Visibility failed'),
    });

    render(<ArtifactPage />);

    expect(await screen.findByText('Versions unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Workspace' }));

    expect(await screen.findByText('Visibility failed')).toBeInTheDocument();
    expect(screen.getByText('Quarterly chart')).toBeInTheDocument();
  });

  it('reports public-link and clipboard failures', async () => {
    createArtifactPublicLinkMock.mockResolvedValue({
      ok: false,
      error: new Error('Public link failed'),
    });
    clipboardWriteMock.mockRejectedValueOnce(new Error('clipboard unavailable'));
    fetchArtifactMock.mockResolvedValue({
      ok: true,
      value: artifact({ visibility: 'ORGANIZATION' }),
    });

    render(<ArtifactPage />);

    await screen.findByText('Quarterly chart');
    fireEvent.click(screen.getByRole('button', { name: 'Copy artifact URL' }));

    expect(await screen.findByText('Copy failed')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Public' }));

    expect(await screen.findByText('Public link failed')).toBeInTheDocument();
  });
});
