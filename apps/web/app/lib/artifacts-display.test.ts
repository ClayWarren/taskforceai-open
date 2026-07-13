import { describe, expect, it } from 'bun:test';

import type { Artifact, ArtifactVersion } from './api/artifacts';
import {
  canInlineFrame,
  formatArtifactBytes,
  formatArtifactDate,
  getArtifactDownloadUrl,
  getArtifactMetadataDownloadUrl,
  getCurrentArtifactVersion,
  getVersionContentUrl,
} from './artifacts-display';

const baseArtifact: Artifact = {
  id: 'artifact-1',
  ownerUserId: 12,
  type: 'DOCUMENT',
  title: 'Report',
  status: 'READY',
  visibility: 'PRIVATE',
  createdAt: '2026-06-08T12:00:00Z',
  updatedAt: '2026-06-08T12:00:00Z',
};

const version = (overrides: Partial<ArtifactVersion> = {}): ArtifactVersion => ({
  id: 'version-1',
  artifactId: 'artifact-1',
  version: 1,
  fileId: 'file 1',
  createdAt: '2026-06-08T12:00:00Z',
  ...overrides,
});

describe('artifact display helpers', () => {
  it('formats invalid dates and byte sizes for artifact metadata', () => {
    expect(formatArtifactDate('not-a-date')).toBe('not-a-date');
    expect(formatArtifactBytes()).toBe('Unknown size');
    expect(formatArtifactBytes(0)).toBe('Unknown size');
    expect(formatArtifactBytes(42)).toBe('42 B');
    expect(formatArtifactBytes(1536)).toBe('1.5 KB');
    expect(formatArtifactBytes(150 * 1024)).toBe('150 KB');
    expect(formatArtifactBytes(2.5 * 1024 * 1024)).toBe('2.5 MB');
    expect(formatArtifactBytes(150 * 1024 * 1024)).toBe('150 MB');
  });

  it('detects inline-frameable artifact MIME types', () => {
    expect(canInlineFrame('text/html')).toBe(true);
    expect(canInlineFrame('application/pdf')).toBe(true);
    expect(canInlineFrame('application/xhtml+xml')).toBe(true);
    expect(canInlineFrame('image/png')).toBe(false);
    expect(canInlineFrame()).toBe(false);
  });

  it('allows same-origin relative metadata download URLs', () => {
    expect(
      getArtifactMetadataDownloadUrl({
        ...baseArtifact,
        metadata: { downloadUrl: '/api/v1/developer/files/file-1/content' },
      })
    ).toBe('/api/v1/developer/files/file-1/content');
  });

  it('allows HTTPS metadata download URLs', () => {
    expect(
      getArtifactMetadataDownloadUrl({
        ...baseArtifact,
        metadata: { downloadUrl: 'https://files.example.com/report.pdf' },
      })
    ).toBe('https://files.example.com/report.pdf');
  });

  it('drops JavaScript metadata download URLs', () => {
    expect(
      getArtifactMetadataDownloadUrl({
        ...baseArtifact,
        metadata: { downloadUrl: 'javascript:alert(1)' },
      })
    ).toBeNull();
  });

  it('returns version content URLs with encoded file ids', () => {
    expect(getVersionContentUrl(null, 'attachment')).toBeNull();
    expect(getVersionContentUrl(version({ fileId: undefined }), 'attachment')).toBeNull();
    expect(getVersionContentUrl(version(), 'inline')).toBe(
      '/api/v1/developer/files/file%201/content?disposition=inline'
    );
  });

  it('prefers current-version downloads over metadata downloads', () => {
    const artifactWithMetadata = {
      ...baseArtifact,
      metadata: { downloadUrl: 'https://files.example.com/report.pdf' },
    };

    expect(getArtifactDownloadUrl(artifactWithMetadata, version())).toBe(
      '/api/v1/developer/files/file%201/content?disposition=attachment'
    );
    expect(getArtifactDownloadUrl(artifactWithMetadata, null)).toBe(
      'https://files.example.com/report.pdf'
    );
  });

  it('selects the current artifact version with stable fallbacks', () => {
    const first = version({ id: 'version-1', version: 1 });
    const current = version({ id: 'version-2', version: 2 });

    expect(getCurrentArtifactVersion(baseArtifact, [])).toBeNull();
    expect(getCurrentArtifactVersion(baseArtifact, [first, current])).toBe(first);
    expect(
      getCurrentArtifactVersion({ ...baseArtifact, currentVersionId: 'version-2' }, [
        first,
        current,
      ])
    ).toBe(current);
    expect(
      getCurrentArtifactVersion({ ...baseArtifact, currentVersionId: 'missing' }, [first, current])
    ).toBe(first);
  });
});
