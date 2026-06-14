import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../tests/setup/dom';

import type { Artifact, ArtifactVersion } from '../lib/api/artifacts';

const useRouterStateMock = vi.fn(() => '/artifacts');
const fetchArtifactsMock = vi.fn();
const createArtifactPublicLinkMock = vi.fn();
const deleteArtifactMock = vi.fn();
const clipboardWriteMock = vi.fn(async () => undefined);

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: unknown) => config,
  Link: ({ children, params, to, ...props }: any) => (
    <a href={String(to ?? '#').replace('$artifactId', params?.artifactId ?? '')} {...props}>
      {children}
    </a>
  ),
  Outlet: () => <div data-testid="artifact-outlet" />,
  useRouterState: ({ select }: { select: (state: { location: { pathname: string } }) => string }) =>
    select({ location: { pathname: useRouterStateMock() } }),
}));

vi.mock('../app-shell/ProductShellProviders', () => ({
  ProductShellProviders: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="product-shell-providers">{children}</div>
  ),
}));

vi.mock('../app-shell/StandaloneRouteShell', () => ({
  StandaloneRouteShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="standalone-route-shell">{children}</div>
  ),
}));

vi.mock('../lib/providers/AuthProvider', () => ({
  useAuth: () => ({ isAuthenticated: true, isLoading: false }),
}));

vi.mock('../lib/api/artifacts', () => ({
  fetchArtifacts: fetchArtifactsMock,
  createArtifactPublicLink: createArtifactPublicLinkMock,
  deleteArtifact: deleteArtifactMock,
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
  currentVersion: version(),
  createdAt: '2026-06-12T12:00:00Z',
  updatedAt: '2026-06-12T12:00:00Z',
  ...overrides,
});

const { ArtifactsPage } = await import('./artifacts');

describe('ArtifactsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRouterStateMock.mockReturnValue('/artifacts');
    fetchArtifactsMock.mockResolvedValue({
      ok: true,
      value: [
        artifact(),
        artifact({
          id: 'artifact-2',
          type: 'DOCUMENT',
          title: 'Research memo',
          currentVersionId: 'version-2',
          currentVersion: version({
            id: 'version-2',
            artifactId: 'artifact-2',
            fileId: 'file-2',
            mimeType: 'application/pdf',
            filename: 'memo.pdf',
          }),
        }),
      ],
    });
    createArtifactPublicLinkMock.mockResolvedValue({
      ok: true,
      value: {
        token: 'public-token',
        url: 'https://taskforceai.chat/artifacts/public/public-token',
        artifact: artifact({ visibility: 'PUBLIC_LINK' }),
      },
    });
    deleteArtifactMock.mockResolvedValue({ ok: true });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWriteMock },
    });
  });

  afterEach(() => cleanup());

  it('loads the artifact library and handles public links and deletion', async () => {
    render(<ArtifactsPage />);

    await waitFor(() => expect(screen.getByText('chart.png')).toBeInTheDocument());
    expect(fetchArtifactsMock).toHaveBeenCalledWith({ includeCurrentVersion: true });
    expect(screen.getByText('memo.pdf')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create public link for Quarterly chart' }));

    await waitFor(() => expect(createArtifactPublicLinkMock).toHaveBeenCalledWith('artifact-1'));
    expect(clipboardWriteMock).toHaveBeenCalledWith(
      'https://taskforceai.chat/artifacts/public/public-token'
    );
    expect(screen.getByText('Public link copied')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Quarterly chart' }));
    expect(screen.getByText('Click delete again to confirm')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete Quarterly chart' }));

    await waitFor(() => expect(deleteArtifactMock).toHaveBeenCalledWith('artifact-1'));
    expect(screen.getByText('Artifact deleted')).toBeInTheDocument();
  });

  it('renders nested public artifact routes without the private shell', () => {
    useRouterStateMock.mockReturnValue('/artifacts/public/public-token');

    render(<ArtifactsPage />);

    expect(screen.getByTestId('artifact-outlet')).toBeInTheDocument();
    expect(screen.queryByTestId('product-shell-providers')).not.toBeInTheDocument();
    expect(fetchArtifactsMock).not.toHaveBeenCalled();
  });
});
