import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../tests/setup/dom';

import type { Artifact, ArtifactVersion, PublicArtifact } from '../lib/api/artifacts';

const useParamsMock = vi.fn(() => ({ token: 'public token' }));
const fetchMock = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    options: config,
    useParams: useParamsMock,
  }),
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

const publicArtifactResponse = (value: PublicArtifact) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const { Route } = await import('./artifacts.public.$token');
const PublicArtifactPage = Route.options.component!;

describe('PublicArtifactPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'fetch', {
      configurable: true,
      value: fetchMock,
    });
    Object.defineProperty(global, 'fetch', {
      configurable: true,
      value: fetchMock,
    });
    useParamsMock.mockReturnValue({ token: 'public token' });
    fetchMock.mockResolvedValue(publicArtifactResponse(publicArtifact()));
  });

  afterEach(() => cleanup());

  it('loads a public artifact and renders download content with encoded token URLs', async () => {
    fetchMock.mockResolvedValueOnce(
      publicArtifactResponse(
        publicArtifact({
          artifact: artifact({ type: 'ARCHIVE', title: 'Launch bundle' }),
          version: version({ mimeType: 'application/zip', filename: 'launch.zip' }),
        })
      )
    );

    render(<PublicArtifactPage />);

    await waitFor(() => expect(screen.getByText('Launch bundle')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/artifacts/public/public%20token');
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute(
      'href',
      '/api/v1/artifacts/public/public%20token/content'
    );
    expect(screen.getByText('ARCHIVE')).toBeInTheDocument();
    expect(screen.getByText('v1')).toBeInTheDocument();
    expect(screen.getByText('application/zip')).toBeInTheDocument();
  });

  it('renders image previews with encoded inline content URLs', async () => {
    fetchMock.mockResolvedValueOnce(
      publicArtifactResponse(
        publicArtifact({
          artifact: artifact({ type: 'IMAGE', title: 'Launch chart' }),
          version: version({ mimeType: 'image/png', filename: 'chart.png' }),
        })
      )
    );

    render(<PublicArtifactPage />);

    const image = await screen.findByRole('img', { name: 'Launch chart' });
    expect(image).toHaveAttribute(
      'src',
      '/api/v1/artifacts/public/public%20token/content?disposition=inline'
    );
  });

  it('renders video previews with encoded inline content URLs', async () => {
    fetchMock.mockResolvedValueOnce(
      publicArtifactResponse(
        publicArtifact({
          artifact: artifact({ type: 'VIDEO', title: 'Launch walkthrough' }),
          version: version({ mimeType: 'video/mp4', filename: 'walkthrough.mp4' }),
        })
      )
    );

    render(<PublicArtifactPage />);

    const video = await screen.findByLabelText('Launch walkthrough');
    expect(video).toHaveAttribute(
      'src',
      '/api/v1/artifacts/public/public%20token/content?disposition=inline'
    );
  });

  it('renders inline frames for site artifacts and inline document MIME types', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fetchMock.mockResolvedValueOnce(
      publicArtifactResponse(
        publicArtifact({
          artifact: artifact({ type: 'DOCUMENT', title: 'Launch PDF' }),
          version: version({ mimeType: 'application/pdf', filename: 'launch.pdf' }),
        })
      )
    );

    render(<PublicArtifactPage />);

    const pdfFrame = await screen.findByTitle('Launch PDF');
    expect(pdfFrame).toHaveAttribute(
      'src',
      '/api/v1/artifacts/public/public%20token/content?disposition=inline'
    );

    cleanup();
    useParamsMock.mockReturnValue({ token: 'site token' });
    fetchMock.mockResolvedValueOnce(
      publicArtifactResponse(
        publicArtifact({
          artifact: artifact({ type: 'SITE', title: 'Launch microsite' }),
          version: version({ mimeType: undefined, filename: 'index.html' }),
        })
      )
    );

    render(<PublicArtifactPage />);

    const siteFrame = await screen.findByTitle('Launch microsite');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/artifacts/public/site%20token');
    expect(siteFrame).toHaveAttribute(
      'src',
      '/api/v1/artifacts/public/site%20token/content?disposition=inline'
    );
    consoleErrorSpy.mockRestore();
  });

  it('renders server errors for invalid public artifact links', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Public artifact link expired' }), {
        status: 410,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    render(<PublicArtifactPage />);

    await waitFor(() =>
      expect(screen.getByText('Public artifact link expired')).toBeInTheDocument()
    );
  });

  it('ignores fetch results after unmounting', async () => {
    let resolveFetch: (result: Response) => void = () => {};
    const pendingFetch = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    fetchMock.mockReturnValueOnce(pendingFetch);

    const { unmount } = render(<PublicArtifactPage />);
    unmount();

    resolveFetch(
      publicArtifactResponse(
        publicArtifact({ artifact: artifact({ title: 'Unmounted artifact' }) })
      )
    );
    await Promise.resolve();

    expect(screen.queryByText('Unmounted artifact')).not.toBeInTheDocument();
  });
});
