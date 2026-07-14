import { createFileRoute } from '@tanstack/react-router';
import { Download, ExternalLink, FileText } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { PublicArtifact } from '../lib/api/artifacts';
import { fetchPublicArtifact } from '../lib/api/artifacts';
import { canInlineFrame, formatArtifactDate } from '../lib/artifacts-display';

export const Route = createFileRoute('/artifacts/public/$token')({
  component: PublicArtifactPage,
});

function PublicArtifactPage() {
  const { token } = Route.useParams();
  const [artifact, setArtifact] = useState<PublicArtifact | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const inlineUrl = `/api/v1/artifacts/public/${encodeURIComponent(token)}/content?disposition=inline`;
  const downloadUrl = `/api/v1/artifacts/public/${encodeURIComponent(token)}/content`;

  useEffect(() => {
    let active = true;
    setLoading(true);
    void fetchPublicArtifact(token).then((result) => {
      if (!active) {
        return;
      }
      if (result.ok) {
        setArtifact(result.value);
        setErrorMessage(null);
      } else {
        setArtifact(null);
        setErrorMessage(result.error.message);
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [token]);

  return (
    <main className="fixed inset-0 overflow-auto bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-5 py-6 sm:px-8">
        <header className="border-b border-slate-800 pb-5">
          <div className="text-sm text-slate-400">TaskForceAI public artifact</div>
          <h1 className="mt-2 truncate text-2xl font-semibold tracking-normal text-slate-50">
            {artifact?.artifact.title ?? 'Artifact'}
          </h1>
        </header>

        {loading ? (
          <div className="grid min-h-[420px] place-items-center text-sm text-slate-400">
            Loading artifact
          </div>
        ) : errorMessage ? (
          <div className="grid min-h-[420px] place-items-center px-4 text-sm text-red-200">
            {errorMessage}
          </div>
        ) : artifact ? (
          <section className="grid gap-5 py-5 lg:grid-cols-[1fr_280px]">
            <div className="min-h-[420px] rounded-md border border-slate-800 bg-slate-950/60 p-5">
              {artifact.version.mimeType?.startsWith('image/') ? (
                <div className="flex min-h-[380px] items-center justify-center rounded-md bg-slate-900/50 p-3">
                  <img
                    src={inlineUrl}
                    alt={artifact.artifact.title}
                    className="max-h-[68vh] max-w-full rounded-md object-contain"
                  />
                </div>
              ) : artifact.version.mimeType?.startsWith('video/') ? (
                <video
                  src={inlineUrl}
                  controls
                  className="min-h-[380px] w-full rounded-md bg-black"
                  aria-label={artifact.artifact.title}
                />
              ) : artifact.artifact.type === 'SITE' || canInlineFrame(artifact.version.mimeType) ? (
                <iframe
                  title={artifact.artifact.title}
                  src={inlineUrl}
                  sandbox="allow-scripts allow-forms allow-popups"
                  className="h-[68vh] min-h-[420px] w-full rounded-md border border-slate-800 bg-white"
                />
              ) : (
                <div className="flex min-h-[380px] flex-col items-center justify-center text-center">
                  <FileText className="h-9 w-9 text-slate-500" aria-hidden="true" />
                  <div className="mt-3 text-sm text-slate-300">
                    Preview unavailable for this artifact type
                  </div>
                  <a
                    href={downloadUrl}
                    className="mt-4 inline-flex h-9 items-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 transition hover:border-blue-500/60 hover:text-blue-300"
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                    Download
                  </a>
                </div>
              )}
            </div>

            <aside className="space-y-4">
              <section className="rounded-md border border-slate-800 bg-slate-950/70 p-4">
                <h2 className="flex items-center gap-2 text-sm font-medium text-slate-200">
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  Details
                </h2>
                <dl className="mt-3 space-y-3 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Type</dt>
                    <dd className="text-right text-slate-200">{artifact.artifact.type}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Status</dt>
                    <dd className="text-right text-slate-200">{artifact.artifact.status}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Version</dt>
                    <dd className="text-right text-slate-200">v{artifact.version.version}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Created</dt>
                    <dd className="text-right text-slate-200">
                      {formatArtifactDate(artifact.artifact.createdAt)}
                    </dd>
                  </div>
                  {artifact.version.mimeType ? (
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-500">MIME</dt>
                      <dd className="truncate text-right text-slate-200">
                        {artifact.version.mimeType}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </section>
            </aside>
          </section>
        ) : null}
      </div>
    </main>
  );
}
