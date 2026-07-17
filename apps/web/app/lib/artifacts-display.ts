import type { Artifact, ArtifactVersion } from './api/artifacts';
import { safeExternalHref } from './safe-url';

export function formatArtifactDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function formatArtifactBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) {
    return 'Unknown size';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    const value = bytes / 1024;
    return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} KB`;
  }
  const value = bytes / (1024 * 1024);
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} MB`;
}

export function canInlineFrame(mimeType?: string): boolean {
  return Boolean(
    mimeType &&
    (mimeType.startsWith('text/') ||
      mimeType === 'application/pdf' ||
      mimeType === 'application/xhtml+xml')
  );
}

export function getArtifactMetadataDownloadUrl(artifact: Artifact): string | null {
  const metadata = artifact.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  return safeExternalHref((metadata as { downloadUrl?: unknown }).downloadUrl);
}

export function getVersionContentUrl(
  version: ArtifactVersion | null,
  disposition: 'attachment' | 'inline'
): string | null {
  if (!version?.fileId) {
    return null;
  }
  const params = new URLSearchParams({ disposition });
  return `/api/v1/developer/files/${encodeURIComponent(version.fileId)}/content?${params.toString()}`;
}

export function getArtifactDownloadUrl(
  artifact: Artifact,
  currentVersion: ArtifactVersion | null
): string | null {
  return (
    getVersionContentUrl(currentVersion, 'attachment') ?? getArtifactMetadataDownloadUrl(artifact)
  );
}

export function getCurrentArtifactVersion(
  artifact: Artifact,
  versions: ArtifactVersion[]
): ArtifactVersion | null {
  if (versions.length === 0) {
    return null;
  }
  if (!artifact.currentVersionId) {
    return versions[0] ?? null;
  }
  return (
    versions.find((version) => version.id === artifact.currentVersionId) ?? versions[0] ?? null
  );
}
