import { Link, createFileRoute } from '@tanstack/react-router';
import { ArrowLeft, Copy, Download, FileText, History, Lock, RefreshCw, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { Artifact, ArtifactVersion } from '../lib/api/artifacts';
import {
  createArtifactPublicLink,
  fetchArtifact,
  fetchArtifactVersions,
  revokeArtifactPublicLinks,
  updateArtifactVisibility,
} from '../lib/api/artifacts';
import {
  canInlineFrame,
  formatArtifactBytes,
  formatArtifactDate,
  getArtifactMetadataDownloadUrl,
  getCurrentArtifactVersion,
  getVersionContentUrl,
} from '../lib/artifacts-display';
import { useAuth } from '../lib/providers/AuthProvider';

export const Route = createFileRoute('/artifacts/$artifactId')({
  component: ArtifactPage,
});

function ArtifactPreview({
  artifact,
  currentVersion,
  inlineUrl,
  downloadUrl,
}: {
  artifact: Artifact;
  currentVersion: ArtifactVersion | null;
  inlineUrl: string | null;
  downloadUrl: string | null;
}) {
  const mimeType = currentVersion?.mimeType ?? '';

  if (inlineUrl && mimeType.startsWith('image/')) {
    return (
      <div className="flex min-h-[320px] items-center justify-center rounded-md bg-slate-900/50 p-3">
        <img
          src={inlineUrl}
          alt={artifact.title}
          className="max-h-[68vh] max-w-full rounded-md object-contain"
        />
      </div>
    );
  }

  if (inlineUrl && mimeType.startsWith('video/')) {
    return (
      <video
        src={inlineUrl}
        controls
        className="min-h-[320px] w-full rounded-md bg-black"
        aria-label={artifact.title}
      />
    );
  }

  if (inlineUrl && (artifact.type === 'SITE' || canInlineFrame(mimeType))) {
    return (
      <iframe
        title={artifact.title}
        src={inlineUrl}
        sandbox="allow-scripts allow-forms allow-popups"
        className="h-[68vh] min-h-[420px] w-full rounded-md border border-slate-800 bg-white"
      />
    );
  }

  return (
    <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-3 text-center text-slate-400">
      <FileText className="h-8 w-8 text-slate-500" aria-hidden="true" />
      <div className="text-sm">Preview unavailable for this artifact type</div>
      {downloadUrl ? (
        <a
          href={downloadUrl}
          className="mt-2 inline-flex h-9 items-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 transition hover:border-blue-500/60 hover:text-blue-300"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Download current file
        </a>
      ) : null}
    </div>
  );
}

export function ArtifactPage() {
  const { artifactId } = Route.useParams();
  const { isAuthenticated, isLoading } = useAuth();
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [versions, setVersions] = useState<ArtifactVersion[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [visibilityUpdating, setVisibilityUpdating] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [publicUrl, setPublicUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (isLoading) {
      return;
    }
    if (!isAuthenticated) {
      setLoading(false);
      setArtifact(null);
      setVersions([]);
      return;
    }
    setLoading(true);
    void Promise.all([fetchArtifact(artifactId), fetchArtifactVersions(artifactId)]).then(
      ([artifactResult, versionsResult]) => {
        if (!active) {
          return;
        }
        if (!artifactResult.ok) {
          setErrorMessage(artifactResult.error.message);
          setLoading(false);
          return;
        }
        setArtifact(artifactResult.value);
        setVersions(versionsResult.ok ? versionsResult.value : []);
        setErrorMessage(versionsResult.ok ? null : versionsResult.error.message);
        setLoading(false);
      }
    );
    return () => {
      active = false;
    };
  }, [artifactId, isAuthenticated, isLoading]);

  const currentVersion = useMemo(() => {
    return artifact ? getCurrentArtifactVersion(artifact, versions) : null;
  }, [artifact, versions]);

  const currentVersionDownloadUrl = getVersionContentUrl(currentVersion, 'attachment');
  const currentVersionInlineUrl = getVersionContentUrl(currentVersion, 'inline');
  const downloadUrl =
    currentVersionDownloadUrl ?? (artifact ? getArtifactMetadataDownloadUrl(artifact) : null);
  const artifactUrl =
    typeof window === 'undefined' ? `/artifacts/${artifactId}` : window.location.href;

  const setVisibility = async (visibility: 'PRIVATE' | 'ORGANIZATION') => {
    if (!artifact || artifact.visibility === visibility || visibilityUpdating) {
      return;
    }
    if (visibility === 'PRIVATE' && artifact.visibility === 'PUBLIC_LINK') {
      await revokePublicLinks();
      return;
    }
    setVisibilityUpdating(true);
    setErrorMessage(null);
    const result = await updateArtifactVisibility(artifact.id, visibility);
    if (result.ok) {
      setArtifact(result.value);
    } else {
      setErrorMessage(result.error.message);
    }
    setVisibilityUpdating(false);
  };

  const copySharedUrl = async () => {
    const url = publicUrl ?? artifactUrl;
    setCopyStatus('idle');
    try {
      await navigator.clipboard.writeText(url);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('failed');
    }
  };

  const createPublicLink = async () => {
    if (!artifact || visibilityUpdating) {
      return;
    }
    setVisibilityUpdating(true);
    setErrorMessage(null);
    const result = await createArtifactPublicLink(artifact.id);
    if (result.ok) {
      setArtifact(result.value.artifact);
      setPublicUrl(result.value.url);
      setCopyStatus('idle');
    } else {
      setErrorMessage(result.error.message);
    }
    setVisibilityUpdating(false);
  };

  const revokePublicLinks = async () => {
    if (!artifact || visibilityUpdating) {
      return;
    }
    setVisibilityUpdating(true);
    setErrorMessage(null);
    const result = await revokeArtifactPublicLinks(artifact.id);
    if (result.ok) {
      setArtifact({ ...artifact, visibility: 'PRIVATE' });
      setPublicUrl(null);
      setCopyStatus('idle');
    } else {
      setErrorMessage(result.error.message);
    }
    setVisibilityUpdating(false);
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-5 py-6 text-slate-100 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-5">
        <div className="min-w-0">
          <Link
            to="/artifacts"
            className="inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-slate-100"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Artifacts
          </Link>
          <h1 className="mt-2 truncate text-2xl font-semibold tracking-normal text-slate-50">
            {artifact?.title ?? 'Artifact'}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {downloadUrl ? (
            <a
              href={downloadUrl}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 transition hover:border-blue-500/60 hover:text-blue-300"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Download
            </a>
          ) : null}
          <button
            type="button"
            disabled
            className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-800 bg-slate-900 px-3 text-sm text-slate-500"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Refresh
          </button>
        </div>
      </header>

      {loading ? (
        <div className="grid min-h-[420px] place-items-center border-b border-slate-800 text-sm text-slate-400">
          Loading artifact
        </div>
      ) : !isAuthenticated ? (
        <div className="grid min-h-[420px] place-items-center border-b border-slate-800 text-sm text-slate-400">
          Sign in to view this artifact
        </div>
      ) : errorMessage && !artifact ? (
        <div className="grid min-h-[420px] place-items-center border-b border-red-900/60 px-4 text-sm text-red-200">
          {errorMessage}
        </div>
      ) : artifact ? (
        <section className="grid gap-5 py-5 lg:grid-cols-[1fr_280px]">
          <div className="min-w-0">
            <div className="min-h-[360px] rounded-md border border-slate-800 bg-slate-950/60 p-5">
              <ArtifactPreview
                artifact={artifact}
                currentVersion={currentVersion}
                inlineUrl={currentVersionInlineUrl}
                downloadUrl={downloadUrl}
              />
            </div>
          </div>

          <aside className="space-y-4">
            <section className="rounded-md border border-slate-800 bg-slate-950/70 p-4">
              <h2 className="text-sm font-medium text-slate-200">Share</h2>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void setVisibility('PRIVATE')}
                  disabled={visibilityUpdating || artifact.visibility === 'PRIVATE'}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-2 text-sm text-slate-200 transition hover:border-blue-500/60 disabled:border-blue-500/50 disabled:text-blue-300"
                >
                  <Lock className="h-4 w-4" aria-hidden="true" />
                  Private
                </button>
                <button
                  type="button"
                  onClick={() => void setVisibility('ORGANIZATION')}
                  disabled={visibilityUpdating || artifact.visibility === 'ORGANIZATION'}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-2 text-sm text-slate-200 transition hover:border-blue-500/60 disabled:border-blue-500/50 disabled:text-blue-300"
                >
                  <Users className="h-4 w-4" aria-hidden="true" />
                  Workspace
                </button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void createPublicLink()}
                  disabled={visibilityUpdating}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-2 text-sm text-slate-200 transition hover:border-blue-500/60 disabled:border-blue-500/50 disabled:text-blue-300"
                >
                  <Users className="h-4 w-4" aria-hidden="true" />
                  Public
                </button>
                <button
                  type="button"
                  onClick={() => void revokePublicLinks()}
                  disabled={visibilityUpdating || artifact.visibility !== 'PUBLIC_LINK'}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-2 text-sm text-slate-200 transition hover:border-blue-500/60 disabled:text-slate-500"
                >
                  <Lock className="h-4 w-4" aria-hidden="true" />
                  Revoke
                </button>
              </div>
              {artifact.visibility === 'ORGANIZATION' || publicUrl ? (
                <div className="mt-3 flex min-w-0 items-center gap-2">
                  <div className="min-w-0 flex-1 truncate rounded-md border border-slate-800 bg-slate-900 px-2 py-2 font-mono text-xs text-slate-400">
                    {publicUrl ?? artifactUrl}
                  </div>
                  <button
                    type="button"
                    onClick={() => void copySharedUrl()}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-700 bg-slate-900 text-slate-200 transition hover:border-blue-500/60 hover:text-blue-300"
                    aria-label="Copy artifact URL"
                    title="Copy artifact URL"
                  >
                    <Copy className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              ) : null}
              {copyStatus !== 'idle' ? (
                <div className="mt-2 text-xs text-slate-500">
                  {copyStatus === 'copied' ? 'Copied' : 'Copy failed'}
                </div>
              ) : null}
            </section>

            <section className="rounded-md border border-slate-800 bg-slate-950/70 p-4">
              <h2 className="text-sm font-medium text-slate-200">Details</h2>
              <dl className="mt-3 space-y-3 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Type</dt>
                  <dd className="text-right text-slate-200">{artifact.type}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Status</dt>
                  <dd className="text-right text-slate-200">{artifact.status}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Visibility</dt>
                  <dd className="text-right text-slate-200">{artifact.visibility}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Created</dt>
                  <dd className="text-right text-slate-200">
                    {formatArtifactDate(artifact.createdAt)}
                  </dd>
                </div>
                {currentVersion?.mimeType ? (
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">MIME</dt>
                    <dd className="truncate text-right text-slate-200">
                      {currentVersion.mimeType}
                    </dd>
                  </div>
                ) : null}
                {artifact.taskId ? (
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Task</dt>
                    <dd className="max-w-[160px] truncate text-right font-mono text-xs text-slate-200">
                      {artifact.taskId}
                    </dd>
                  </div>
                ) : null}
                {artifact.conversationId ? (
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Conversation</dt>
                    <dd className="text-right font-mono text-xs text-slate-200">
                      {artifact.conversationId}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </section>

            <section className="rounded-md border border-slate-800 bg-slate-950/70 p-4">
              <h2 className="flex items-center gap-2 text-sm font-medium text-slate-200">
                <History className="h-4 w-4" aria-hidden="true" />
                Versions
              </h2>
              <div className="mt-3 space-y-2">
                {versions.length === 0 ? (
                  <div className="text-sm text-slate-500">No versions</div>
                ) : (
                  versions.map((version) => (
                    <div
                      key={version.id}
                      className="rounded-md border border-slate-800 bg-slate-900/60 p-3"
                    >
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="font-medium text-slate-200">v{version.version}</span>
                        {version.id === currentVersion?.id ? (
                          <span className="text-xs text-blue-300">Current</span>
                        ) : null}
                      </div>
                      <div className="mt-1 truncate text-xs text-slate-500">
                        {version.filename ?? version.fileId ?? version.id}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {formatArtifactBytes(version.bytes)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </aside>
        </section>
      ) : null}
    </div>
  );
}
