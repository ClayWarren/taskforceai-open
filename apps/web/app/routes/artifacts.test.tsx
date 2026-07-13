import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../tests/setup/dom';

import type { Artifact, ArtifactVersion } from '../lib/api/artifacts';

const useRouterStateMock = vi.fn(() => '/artifacts');
const fetchAllArtifactsMock = vi.fn();
const createArtifactPublicLinkMock = vi.fn();
const deleteArtifactMock = vi.fn();
const clipboardWriteMock = vi.fn(async () => undefined);
const authState = {
  isAuthenticated: true,
  isLoading: false,
};

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: unknown) => ({ options: config }),
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
  useAuth: () => authState,
}));

vi.mock('../lib/api/artifacts', () => ({
  fetchAllArtifacts: fetchAllArtifactsMock,
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

const defaultArtifacts = () => [
  artifact(),
  artifact({
    id: 'artifact-2',
    type: 'DOCUMENT',
    title: 'Research memo',
    status: 'FAILED',
    visibility: 'PUBLIC_LINK',
    currentVersionId: 'version-2',
    currentVersion: version({
      id: 'version-2',
      artifactId: 'artifact-2',
      fileId: 'file-2',
      mimeType: 'application/pdf',
      filename: 'memo.pdf',
      bytes: 4096,
    }),
    updatedAt: 'not-a-date',
  }),
  artifact({
    id: 'artifact-3',
    type: 'DASHBOARD',
    title: 'Operations dashboard',
    status: 'PROCESSING',
    visibility: 'ORGANIZATION',
    currentVersionId: undefined,
    currentVersion: undefined,
    updatedAt: new Date().toISOString(),
  }),
];

const { Route } = await import('./artifacts');
const ArtifactsPage = Route.options.component!;

describe('ArtifactsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRouterStateMock.mockReturnValue('/artifacts');
    authState.isAuthenticated = true;
    authState.isLoading = false;
    fetchAllArtifactsMock.mockResolvedValue({
      ok: true,
      value: defaultArtifacts(),
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
    expect(fetchAllArtifactsMock).toHaveBeenCalledWith({ includeCurrentVersion: true });
    expect(screen.getByText('memo.pdf')).toBeInTheDocument();
    expect(screen.getByText('Operations dashboard')).toBeInTheDocument();

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
    expect(fetchAllArtifactsMock).not.toHaveBeenCalled();
  });

  it('shows loading and signed-out states without fetching artifacts', async () => {
    authState.isLoading = true;

    render(<ArtifactsPage />);

    expect(screen.getByText('Loading artifacts')).toBeInTheDocument();
    expect(fetchAllArtifactsMock).not.toHaveBeenCalled();

    cleanup();
    authState.isLoading = false;
    authState.isAuthenticated = false;
    render(<ArtifactsPage />);

    expect(await screen.findByText('Sign in to view artifacts')).toBeInTheDocument();
    expect(fetchAllArtifactsMock).not.toHaveBeenCalled();
  });

  it('shows fetch errors and empty library states', async () => {
    fetchAllArtifactsMock.mockResolvedValueOnce({
      ok: false,
      error: new Error('Artifact service unavailable'),
    });

    render(<ArtifactsPage />);

    expect(await screen.findByText('Artifact service unavailable')).toBeInTheDocument();

    cleanup();
    fetchAllArtifactsMock.mockResolvedValueOnce({ ok: true, value: [] });
    render(<ArtifactsPage />);

    expect(await screen.findByText('No artifacts yet')).toBeInTheDocument();
  });

  it('filters artifacts by kind, status, visibility, and search text', async () => {
    render(<ArtifactsPage />);

    await screen.findByText('chart.png');

    fireEvent.click(screen.getByRole('button', { name: /Images 1/ }));
    expect(screen.getByText('chart.png')).toBeInTheDocument();
    expect(screen.queryByText('memo.pdf')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Files 2/ }));
    expect(screen.queryByText('chart.png')).not.toBeInTheDocument();
    expect(screen.getByText('memo.pdf')).toBeInTheDocument();
    expect(screen.getByText('Operations dashboard')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by status' }), {
      target: { value: 'FAILED' },
    });
    expect(screen.getByText('memo.pdf')).toBeInTheDocument();
    expect(screen.queryByText('Operations dashboard')).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by visibility' }), {
      target: { value: 'ORGANIZATION' },
    });
    expect(screen.getByText('No artifacts match this view')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by status' }), {
      target: { value: 'ALL' },
    });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search artifacts' }), {
      target: { value: 'dashboard' },
    });
    expect(screen.getByText('Operations dashboard')).toBeInTheDocument();
    expect(screen.queryByText('memo.pdf')).not.toBeInTheDocument();
  });

  it('renders grid view and uses fallback labels for artifacts without current versions', async () => {
    render(<ArtifactsPage />);

    await screen.findByText('Operations dashboard');

    fireEvent.click(screen.getByRole('button', { name: 'Grid view' }));

    expect(screen.getByRole('link', { name: 'Operations dashboard' })).toHaveAttribute(
      'href',
      '/artifacts/artifact-3'
    );
    expect(screen.queryByRole('link', { name: 'Download Operations dashboard' })).toBeNull();
    expect(screen.getByText('Unknown size')).toBeInTheDocument();
  });

  it('handles public-link clipboard fallback and share failures', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    render(<ArtifactsPage />);

    await screen.findByText('chart.png');
    fireEvent.click(screen.getByRole('button', { name: 'Create public link for Quarterly chart' }));

    expect(await screen.findByText('Public link created')).toBeInTheDocument();

    createArtifactPublicLinkMock.mockResolvedValueOnce({
      ok: false,
      error: new Error('Share endpoint failed'),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create public link for Research memo' }));

    expect(await screen.findByText('Share endpoint failed')).toBeInTheDocument();
  });

  it('keeps artifacts visible when deletion fails', async () => {
    deleteArtifactMock.mockResolvedValueOnce({ ok: false, error: new Error('Delete denied') });
    render(<ArtifactsPage />);

    await screen.findByText('chart.png');

    fireEvent.click(screen.getByRole('button', { name: 'Delete Quarterly chart' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete Quarterly chart' }));

    expect(await screen.findByText('Delete denied')).toBeInTheDocument();
    expect(screen.getByText('chart.png')).toBeInTheDocument();
  });
});
