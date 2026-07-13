import { Link, Outlet, createFileRoute, useRouterState } from '@tanstack/react-router';
import {
  Copy,
  Download,
  ExternalLink,
  FileArchive,
  FileBarChart,
  FileText,
  Grid2X2,
  Image,
  LayoutPanelTop,
  List,
  Search,
  Table2,
  Trash2,
  Video,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { ProductShellProviders } from '../app-shell/ProductShellProviders';
import { StandaloneRouteShell } from '../app-shell/StandaloneRouteShell';
import type { Artifact, ArtifactVersion } from '../lib/api/artifacts';
import { createArtifactPublicLink, deleteArtifact, fetchAllArtifacts } from '../lib/api/artifacts';
import {
  formatArtifactBytes,
  getArtifactDownloadUrl,
  getVersionContentUrl,
} from '../lib/artifacts-display';
import { useAuth } from '../lib/providers/AuthProvider';

export const Route = createFileRoute('/artifacts')({
  component: ArtifactsPage,
});

const artifactTypeLabels: Record<Artifact['type'], string> = {
  DOCUMENT: 'Document',
  SPREADSHEET: 'Spreadsheet',
  CHART: 'Chart',
  IMAGE: 'Image',
  VIDEO: 'Video',
  SITE: 'Site',
  DASHBOARD: 'Dashboard',
  ARCHIVE: 'Archive',
  OTHER: 'Other',
};

const artifactTypeIcons: Record<Artifact['type'], typeof FileText> = {
  DOCUMENT: FileText,
  SPREADSHEET: Table2,
  CHART: FileBarChart,
  IMAGE: Image,
  VIDEO: Video,
  SITE: LayoutPanelTop,
  DASHBOARD: LayoutPanelTop,
  ARCHIVE: FileArchive,
  OTHER: FileText,
};

type ArtifactKindFilter = 'ALL' | 'IMAGES' | 'FILES';
type ArtifactStatusFilter = Artifact['status'] | 'ALL';
type ArtifactVisibilityFilter = Artifact['visibility'] | 'ALL';
type ArtifactViewMode = 'grid' | 'list';

type ArtifactLibraryItem = {
  artifact: Artifact;
  currentVersion: ArtifactVersion | null;
};

function formatModified(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((today.getTime() - target.getTime()) / 86_400_000);

  if (diffDays === 0) {
    return 'Today';
  }
  if (diffDays === 1) {
    return 'Yesterday';
  }
  if (diffDays > 1 && diffDays < 7) {
    return new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

function isImageItem(item: ArtifactLibraryItem): boolean {
  const mimeType = item.currentVersion?.mimeType ?? '';
  return (
    item.artifact.type === 'IMAGE' ||
    item.artifact.type === 'CHART' ||
    mimeType.startsWith('image/')
  );
}

function isSearchMatch(item: ArtifactLibraryItem, query: string): boolean {
  if (!query) {
    return true;
  }
  const haystack = [
    item.artifact.title,
    item.currentVersion?.filename,
    item.currentVersion?.mimeType,
    artifactTypeLabels[item.artifact.type],
    item.artifact.status,
    item.artifact.visibility,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

function ArtifactsPage() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  if (pathname.startsWith('/artifacts/public/')) {
    return <Outlet />;
  }

  const content = pathname === '/artifacts' ? <ArtifactsLibrary /> : <Outlet />;

  return (
    <ProductShellProviders>
      <StandaloneRouteShell>{content}</StandaloneRouteShell>
    </ProductShellProviders>
  );
}

function ArtifactsLibrary() {
  const { isAuthenticated, isLoading } = useAuth();
  const [items, setItems] = useState<ArtifactLibraryItem[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [kindFilter, setKindFilter] = useState<ArtifactKindFilter>('ALL');
  const [statusFilter, setStatusFilter] = useState<ArtifactStatusFilter>('ALL');
  const [visibilityFilter, setVisibilityFilter] = useState<ArtifactVisibilityFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<ArtifactViewMode>('list');
  const [busyArtifactId, setBusyArtifactId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (isLoading) {
      return;
    }
    if (!isAuthenticated) {
      setLoading(false);
      setItems([]);
      return;
    }

    setLoading(true);
    void fetchAllArtifacts({ includeCurrentVersion: true }).then((result) => {
      if (!active) {
        return;
      }
      if (!result.ok) {
        setErrorMessage(result.error.message);
        setItems([]);
        setLoading(false);
        return;
      }

      setItems(
        result.value.map((artifact) => ({
          artifact,
          currentVersion: artifact.currentVersion ?? null,
        }))
      );
      setErrorMessage(null);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [isAuthenticated, isLoading]);

  const artifacts = useMemo(() => items.map((item) => item.artifact), [items]);

  const countsByKind = useMemo(() => {
    const imageCount = items.filter(isImageItem).length;
    return {
      ALL: items.length,
      IMAGES: imageCount,
      FILES: items.length - imageCount,
    } satisfies Record<ArtifactKindFilter, number>;
  }, [items]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      const kindMatches =
        kindFilter === 'ALL' ||
        (kindFilter === 'IMAGES' && isImageItem(item)) ||
        (kindFilter === 'FILES' && !isImageItem(item));

      return (
        kindMatches &&
        (statusFilter === 'ALL' || item.artifact.status === statusFilter) &&
        (visibilityFilter === 'ALL' || item.artifact.visibility === visibilityFilter) &&
        isSearchMatch(item, normalizedQuery)
      );
    });
  }, [items, kindFilter, searchQuery, statusFilter, visibilityFilter]);

  const statusOptions: ArtifactStatusFilter[] = ['ALL', 'READY', 'PROCESSING', 'FAILED'];
  const visibilityOptions: ArtifactVisibilityFilter[] = [
    'ALL',
    'PRIVATE',
    'ORGANIZATION',
    'PUBLIC_LINK',
  ];

  const shareArtifact = async (artifact: Artifact) => {
    if (busyArtifactId) {
      return;
    }
    setBusyArtifactId(artifact.id);
    setConfirmDeleteId(null);
    setErrorMessage(null);
    setNotice(null);
    const result = await createArtifactPublicLink(artifact.id);
    if (result.ok) {
      setItems((current) =>
        current.map((item) =>
          item.artifact.id === artifact.id ? { ...item, artifact: result.value.artifact } : item
        )
      );
      try {
        if (!navigator.clipboard?.writeText) {
          throw new Error('Clipboard unavailable');
        }
        await navigator.clipboard.writeText(result.value.url);
        setNotice('Public link copied');
      } catch {
        setNotice('Public link created');
      }
    } else {
      setErrorMessage(result.error.message);
    }
    setBusyArtifactId(null);
  };

  const removeArtifact = async (artifact: Artifact) => {
    if (busyArtifactId) {
      return;
    }
    if (confirmDeleteId !== artifact.id) {
      setConfirmDeleteId(artifact.id);
      setNotice('Click delete again to confirm');
      return;
    }
    setBusyArtifactId(artifact.id);
    setErrorMessage(null);
    setNotice(null);
    const result = await deleteArtifact(artifact.id);
    if (result.ok) {
      setItems((current) => current.filter((item) => item.artifact.id !== artifact.id));
      setConfirmDeleteId(null);
      setNotice('Artifact deleted');
    } else {
      setErrorMessage(result.error.message);
    }
    setBusyArtifactId(null);
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-6 text-slate-100 sm:px-8">
      <header className="flex flex-col gap-5 pb-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <Link
              to="/"
              search={{ plan: undefined }}
              className="text-sm text-slate-400 transition hover:text-slate-100"
            >
              TaskForceAI
            </Link>
            <h1 className="mt-2 text-4xl font-semibold tracking-normal text-slate-50">Artifacts</h1>
          </div>
          <div className="flex w-full flex-col gap-3 sm:flex-row lg:w-auto lg:items-center">
            <label className="relative block min-w-0 flex-1 lg:w-[360px] lg:flex-none">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-500"
                aria-hidden="true"
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search artifacts"
                className="h-11 w-full rounded-full border border-slate-700 bg-slate-900/90 pr-4 pl-10 text-sm text-slate-100 transition outline-none placeholder:text-slate-500 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
                aria-label="Search artifacts"
              />
            </label>
            <div className="flex h-11 shrink-0 items-center rounded-full border border-slate-800 bg-slate-900 p-1">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={`flex h-9 w-9 items-center justify-center rounded-full transition ${
                  viewMode === 'grid'
                    ? 'bg-slate-700 text-slate-50'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
                aria-label="Grid view"
                title="Grid view"
              >
                <Grid2X2 className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={`flex h-9 w-9 items-center justify-center rounded-full transition ${
                  viewMode === 'list'
                    ? 'bg-slate-700 text-slate-50'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
                aria-label="List view"
                title="List view"
              >
                <List className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-b border-slate-800 pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {(['ALL', 'IMAGES', 'FILES'] satisfies ArtifactKindFilter[]).map((kind) => (
              <button
                type="button"
                key={kind}
                onClick={() => setKindFilter(kind)}
                className={`flex h-9 items-center gap-2 rounded-full px-4 text-sm transition ${
                  kindFilter === kind
                    ? 'bg-slate-700 text-slate-50'
                    : 'text-slate-400 hover:bg-slate-900 hover:text-slate-100'
                }`}
              >
                <span>{kind === 'ALL' ? 'All' : kind === 'IMAGES' ? 'Images' : 'Files'}</span>
                <span className="text-xs text-slate-400 tabular-nums">{countsByKind[kind]}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as ArtifactStatusFilter)}
              className="h-9 rounded-md border border-slate-800 bg-slate-900 px-2 text-sm text-slate-200"
              aria-label="Filter by status"
            >
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status === 'ALL' ? 'All statuses' : status}
                </option>
              ))}
            </select>
            <select
              value={visibilityFilter}
              onChange={(event) =>
                setVisibilityFilter(event.target.value as ArtifactVisibilityFilter)
              }
              className="h-9 rounded-md border border-slate-800 bg-slate-900 px-2 text-sm text-slate-200"
              aria-label="Filter by visibility"
            >
              {visibilityOptions.map((visibility) => (
                <option key={visibility} value={visibility}>
                  {visibility === 'ALL' ? 'All visibility' : visibility}
                </option>
              ))}
            </select>
            <div className="flex h-9 items-center rounded-md border border-slate-800 bg-slate-900 px-3 text-sm text-slate-400">
              {filteredItems.length} of {artifacts.length}
            </div>
          </div>
        </div>
        {notice ? <div className="text-sm text-slate-400">{notice}</div> : null}
        {errorMessage && artifacts.length > 0 ? (
          <div className="text-sm text-red-200">{errorMessage}</div>
        ) : null}
      </header>

      <section aria-label="Artifact library" className="min-w-0 pb-8">
        {loading ? (
          <LibraryState>Loading artifacts</LibraryState>
        ) : !isAuthenticated ? (
          <LibraryState>Sign in to view artifacts</LibraryState>
        ) : errorMessage && artifacts.length === 0 ? (
          <LibraryState tone="error">{errorMessage}</LibraryState>
        ) : artifacts.length === 0 ? (
          <LibraryState>No artifacts yet</LibraryState>
        ) : filteredItems.length === 0 ? (
          <LibraryState>No artifacts match this view</LibraryState>
        ) : viewMode === 'list' ? (
          <ArtifactList
            items={filteredItems}
            busyArtifactId={busyArtifactId}
            confirmDeleteId={confirmDeleteId}
            onShare={shareArtifact}
            onRemove={removeArtifact}
          />
        ) : (
          <ArtifactGrid
            items={filteredItems}
            busyArtifactId={busyArtifactId}
            confirmDeleteId={confirmDeleteId}
            onShare={shareArtifact}
            onRemove={removeArtifact}
          />
        )}
      </section>
    </div>
  );
}

function LibraryState({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'error';
}) {
  return (
    <div
      className={`grid min-h-[360px] place-items-center border px-4 text-sm ${
        tone === 'error'
          ? 'border-red-900/60 bg-red-950/20 text-red-200'
          : 'border-slate-800 bg-slate-950/60 text-slate-400'
      }`}
    >
      {children}
    </div>
  );
}

function ArtifactList({
  items,
  busyArtifactId,
  confirmDeleteId,
  onShare,
  onRemove,
}: {
  items: ArtifactLibraryItem[];
  busyArtifactId: string | null;
  confirmDeleteId: string | null;
  onShare: (artifact: Artifact) => Promise<void>;
  onRemove: (artifact: Artifact) => Promise<void>;
}) {
  return (
    <div className="overflow-hidden border border-slate-800">
      <div className="hidden grid-cols-[minmax(0,1fr)_150px_110px_144px] gap-4 border-b border-slate-800 bg-slate-950 px-4 py-3 text-sm text-slate-400 md:grid">
        <div>Name</div>
        <div>Modified</div>
        <div>Size</div>
        <div className="text-right">Actions</div>
      </div>
      {items.map((item) => (
        <ArtifactListRow
          key={item.artifact.id}
          item={item}
          busyArtifactId={busyArtifactId}
          confirmDeleteId={confirmDeleteId}
          onShare={onShare}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
}

function ArtifactListRow({
  item,
  busyArtifactId,
  confirmDeleteId,
  onShare,
  onRemove,
}: {
  item: ArtifactLibraryItem;
  busyArtifactId: string | null;
  confirmDeleteId: string | null;
  onShare: (artifact: Artifact) => Promise<void>;
  onRemove: (artifact: Artifact) => Promise<void>;
}) {
  const { artifact, currentVersion } = item;
  return (
    <div className="grid min-h-[76px] grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-slate-800 bg-slate-950/70 px-4 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_150px_110px_144px] md:items-center md:gap-4">
      <ArtifactName item={item} />
      <div className="hidden text-sm text-slate-300 md:block">
        {formatModified(artifact.updatedAt)}
      </div>
      <div className="hidden text-sm text-slate-300 md:block">
        {formatArtifactBytes(currentVersion?.bytes)}
      </div>
      <ArtifactActions
        item={item}
        busyArtifactId={busyArtifactId}
        confirmDeleteId={confirmDeleteId}
        onShare={onShare}
        onRemove={onRemove}
      />
      <div className="col-span-2 flex gap-3 text-xs text-slate-500 md:hidden">
        <span>{formatModified(artifact.updatedAt)}</span>
        <span>{formatArtifactBytes(currentVersion?.bytes)}</span>
      </div>
    </div>
  );
}

function ArtifactGrid({
  items,
  busyArtifactId,
  confirmDeleteId,
  onShare,
  onRemove,
}: {
  items: ArtifactLibraryItem[];
  busyArtifactId: string | null;
  confirmDeleteId: string | null;
  onShare: (artifact: Artifact) => Promise<void>;
  onRemove: (artifact: Artifact) => Promise<void>;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => {
        const { artifact, currentVersion } = item;
        return (
          <article key={artifact.id} className="border border-slate-800 bg-slate-950/70">
            <Link
              to="/artifacts/$artifactId"
              params={{ artifactId: artifact.id }}
              className="block"
            >
              <ArtifactThumbnail item={item} size="large" />
            </Link>
            <div className="space-y-3 p-4">
              <ArtifactName item={item} compact />
              <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
                <span>{formatModified(artifact.updatedAt)}</span>
                <span>{formatArtifactBytes(currentVersion?.bytes)}</span>
              </div>
              <ArtifactActions
                item={item}
                busyArtifactId={busyArtifactId}
                confirmDeleteId={confirmDeleteId}
                onShare={onShare}
                onRemove={onRemove}
              />
            </div>
          </article>
        );
      })}
    </div>
  );
}

function ArtifactName({ item, compact = false }: { item: ArtifactLibraryItem; compact?: boolean }) {
  const { artifact, currentVersion } = item;
  return (
    <div className="flex min-w-0 items-center gap-3">
      {!compact ? <ArtifactThumbnail item={item} size="small" /> : null}
      <div className="min-w-0">
        <Link
          to="/artifacts/$artifactId"
          params={{ artifactId: artifact.id }}
          className="block truncate font-medium text-slate-100 transition hover:text-blue-300"
        >
          {currentVersion?.filename ?? artifact.title}
        </Link>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
          <span>{artifactTypeLabels[artifact.type]}</span>
          <span>{artifact.status}</span>
          <span>{artifact.visibility}</span>
        </div>
      </div>
    </div>
  );
}

function ArtifactThumbnail({ item, size }: { item: ArtifactLibraryItem; size: 'small' | 'large' }) {
  const Icon = artifactTypeIcons[item.artifact.type];
  const inlineUrl = getVersionContentUrl(item.currentVersion, 'inline');
  const mimeType = item.currentVersion?.mimeType ?? '';
  const canShowImage = inlineUrl && mimeType.startsWith('image/');
  const dimensions =
    size === 'small' ? 'h-11 w-11 rounded-md' : 'aspect-[4/3] w-full border-b border-slate-800';

  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden bg-slate-900 text-slate-300 ${dimensions}`}
    >
      {canShowImage ? (
        <img
          src={inlineUrl}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          aria-hidden="true"
        />
      ) : (
        <Icon className={size === 'small' ? 'h-5 w-5' : 'h-9 w-9'} aria-hidden="true" />
      )}
    </div>
  );
}

function ArtifactActions({
  item,
  busyArtifactId,
  confirmDeleteId,
  onShare,
  onRemove,
}: {
  item: ArtifactLibraryItem;
  busyArtifactId: string | null;
  confirmDeleteId: string | null;
  onShare: (artifact: Artifact) => Promise<void>;
  onRemove: (artifact: Artifact) => Promise<void>;
}) {
  const { artifact, currentVersion } = item;
  const downloadUrl = getArtifactDownloadUrl(artifact, currentVersion);
  const isBusy = busyArtifactId === artifact.id;
  const isConfirmingDelete = confirmDeleteId === artifact.id;

  return (
    <div className="flex items-center justify-end gap-2">
      {downloadUrl ? (
        <a
          href={downloadUrl}
          className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-800 bg-slate-900 text-slate-300 transition hover:border-blue-500/60 hover:text-blue-300"
          aria-label={`Download ${artifact.title}`}
          title="Download"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
        </a>
      ) : null}
      <button
        type="button"
        onClick={() => void onShare(artifact)}
        disabled={Boolean(busyArtifactId)}
        className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-800 bg-slate-900 text-slate-300 transition hover:border-blue-500/60 hover:text-blue-300 disabled:text-slate-600"
        aria-label={`Create public link for ${artifact.title}`}
        title="Create public link"
      >
        <Copy className="h-4 w-4" aria-hidden="true" />
      </button>
      <Link
        to="/artifacts/$artifactId"
        params={{ artifactId: artifact.id }}
        className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-800 bg-slate-900 text-slate-300 transition hover:border-blue-500/60 hover:text-blue-300"
        aria-label={`Open ${artifact.title}`}
        title="Open"
      >
        <ExternalLink className="h-4 w-4" aria-hidden="true" />
      </Link>
      <button
        type="button"
        onClick={() => void onRemove(artifact)}
        disabled={Boolean(busyArtifactId)}
        className={`flex h-9 w-9 items-center justify-center rounded-md border transition disabled:text-slate-600 ${
          isConfirmingDelete
            ? 'border-red-400/70 bg-red-500/15 text-red-200'
            : 'border-slate-800 bg-slate-900 text-slate-300 hover:border-red-500/60 hover:text-red-300'
        }`}
        aria-label={
          isConfirmingDelete ? `Confirm delete ${artifact.title}` : `Delete ${artifact.title}`
        }
        title={isConfirmingDelete ? 'Confirm delete' : 'Delete'}
      >
        <Trash2 className={`h-4 w-4 ${isBusy ? 'animate-pulse' : ''}`} aria-hidden="true" />
      </button>
    </div>
  );
}
