import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../tests/setup/dom';

import type { Artifact, ArtifactVersion, PublicArtifact } from '../lib/api/artifacts';

const useParamsMock = vi.fn(() => ({ token: 'public token' }));
const fetchPublicArtifactMock = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    ...config,
    useParams: useParamsMock,
  }),
}));

vi.mock('../lib/api/artifacts', () => ({
  fetchPublicArtifact: fetchPublicArtifactMock,
}));

const artifact = (overrides: Partial<Artifact> = {}): Artifact => ({
  id: 'artifact-1',
  ownerUserId: 12,
  type: 'SITE',
  title: 'Launch site',
  status: 'READY',
  visibility: 'PUBLIC_LINK',
  currentVersionId: 'version-1',
  createdAt: '2026-06-12T12:00:00Z',
  updatedAt: '2026-06-12T12:00:00Z',
  ...overrides,
});

const version = (overrides: Partial<ArtifactVersion> = {}): ArtifactVersion => ({
  id: 'version-1',
  artifactId: 'artifact-1',
  version: 1,
  fileId: 'file-1',
  mimeType: 'text/html',
  filename: 'index.html',
  bytes: 4096,
  createdAt: '2026-06-12T12:00:00Z',
  ...overrides,
});

const publicArtifact = (overrides: Partial<PublicArtifact> = {}): PublicArtifact => ({
  artifact: artifact(),
  version: version(),
  ...overrides,
});

const { PublicArtifactPage } = await import('./artifacts.public.$token');

describe('PublicArtifactPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useParamsMock.mockReturnValue({ token: 'public token' });
    fetchPublicArtifactMock.mockResolvedValue({ ok: true, value: publicArtifact() });
  });

  afterEach(() => cleanup());

  it('loads a public artifact and renders download content with encoded token URLs', async () => {
    fetchPublicArtifactMock.mockResolvedValueOnce({
      ok: true,
      value: publicArtifact({
        artifact: artifact({ type: 'ARCHIVE', title: 'Launch bundle' }),
        version: version({ mimeType: 'application/zip', filename: 'launch.zip' }),
      }),
    });

    render(<PublicArtifactPage />);

    await waitFor(() => expect(screen.getByText('Launch bundle')).toBeInTheDocument());
    expect(fetchPublicArtifactMock).toHaveBeenCalledWith('public token');
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute(
      'href',
      '/api/v1/artifacts/public/public%20token/content'
    );
    expect(screen.getByText('ARCHIVE')).toBeInTheDocument();
    expect(screen.getByText('v1')).toBeInTheDocument();
    expect(screen.getByText('application/zip')).toBeInTheDocument();
  });

  it('renders server errors for invalid public artifact links', async () => {
    fetchPublicArtifactMock.mockResolvedValueOnce({
      ok: false,
      error: new Error('Public artifact link expired'),
    });

    render(<PublicArtifactPage />);

    await waitFor(() =>
      expect(screen.getByText('Public artifact link expired')).toBeInTheDocument()
    );
  });
});
