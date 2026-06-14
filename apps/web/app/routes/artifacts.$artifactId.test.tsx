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

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    ...config,
    useParams: useParamsMock,
  }),
  Link: ({ children, to, ...props }: any) => (
    <a href={String(to ?? '#')} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('../lib/providers/AuthProvider', () => ({
  useAuth: () => ({ isAuthenticated: true, isLoading: false }),
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

const { ArtifactPage } = await import('./artifacts.$artifactId');

describe('ArtifactPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
