import { useQuery } from '@tanstack/react-query';

import { getMobileBaseUrl } from '../../config/base-url';
import { createModuleLogger } from '../../logger';
import { getMobilePinnedFetch } from '../../api/client';
import { sqliteStorage } from '../../storage/sqlite-adapter';
import { err, ok, type Result } from '@taskforceai/client-core/result';
import {
  createArtifactsClient,
  type ApiArtifact as MobileArtifact,
  type ApiArtifactShare as MobileArtifactShare,
  type ApiArtifactVersion as MobileArtifactVersion,
} from '@taskforceai/api-client/api/artifacts';
import { readApiErrorMessage } from '@taskforceai/api-client/api/response';
import { unwrapResult } from '@taskforceai/api-client/api/result-helpers';
import { queryKeys } from './queryKeys';
import * as FileSystem from '../../utils/file-system';
import {
  assertProductionDomain,
  assertProductionPinConfiguration,
} from '../../security/certificate-pinning';

const logger = createModuleLogger('MobileArtifacts');
export type { MobileArtifact, MobileArtifactShare, MobileArtifactVersion };
const MAX_MOBILE_ARTIFACT_DOWNLOAD_BYTES = 100 * 1024 * 1024;

const absoluteApiUrl = (path: string): string => `${getMobileBaseUrl().replace(/\/+$/, '')}${path}`;

const authHeaders = async (initial?: HeadersInit, authenticated = true): Promise<Headers> => {
  const headers = new Headers(initial);
  headers.set('Accept', 'application/json');
  headers.set('User-Agent', 'TaskForceAI-Mobile');
  if (authenticated) {
    const session = await sqliteStorage.getSession();
    if (session.ok && session.value.accessToken) {
      headers.set('Authorization', `Bearer ${session.value.accessToken}`);
    }
  }
  return headers;
};

const artifactsClient = createArtifactsClient({
  request: async (path, init, authenticated) =>
    getMobilePinnedFetch()(absoluteApiUrl(path), {
      ...init,
      headers: await authHeaders(init?.headers, authenticated),
    }),
  onError: (message, details) => logger.error(message, details),
  onInvalid: (operation, error) => {
    const message =
      operation === 'fetchArtifactVersions'
        ? 'Artifact version response validation failed'
        : operation === 'createArtifactPublicLink'
          ? 'Artifact share response validation failed'
          : 'Artifact API response validation failed';
    logger.warn(message, { error: error.flatten() });
  },
});

export function useArtifactsQuery(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.artifacts,
    queryFn: async () =>
      unwrapResult(await artifactsClient.fetchArtifacts({ includeCurrentVersion: true })),
    enabled,
    staleTime: 60_000,
  });
}

export function useArtifactVersionsQuery(artifactId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: artifactId ? queryKeys.artifactVersions(artifactId) : ['artifacts', 'versions', 'idle'],
    queryFn: artifactId
      ? async () => unwrapResult(await artifactsClient.fetchArtifactVersions(artifactId))
      : async () => [],
    enabled: enabled && !!artifactId,
    staleTime: 60_000,
  });
}

export function getArtifactMetadataDownloadUrl(artifact: MobileArtifact): string | null {
  const metadata = artifact.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  const url = (metadata as { downloadUrl?: unknown }).downloadUrl;
  return typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null;
}

export function getArtifactFileContentUrl(version?: MobileArtifactVersion | null): string | null {
  if (!version?.fileId) {
    return null;
  }
  const params = new URLSearchParams({ disposition: 'attachment' });
  return absoluteApiUrl(
    `/api/v1/developer/files/${encodeURIComponent(version.fileId)}/content?${params.toString()}`
  );
}

export async function downloadMobileArtifactContent(
  contentUrl: string,
  destinationUri: string,
  options: {
    expectedBytes?: number;
    maxBytes?: number;
  } = {}
): Promise<Result<string>> {
  const maxBytes = options.maxBytes ?? MAX_MOBILE_ARTIFACT_DOWNLOAD_BYTES;
  if (options.expectedBytes !== undefined && options.expectedBytes > maxBytes) {
    return err(
      new Error(
        `Artifact exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MB mobile download limit`
      )
    );
  }

  let exceededLimit = false;
  const controller = new AbortController();
  try {
    assertProductionPinConfiguration();
    assertProductionDomain(contentUrl);
    const headers = Object.fromEntries((await authHeaders()).entries());
    await FileSystem.downloadFileAsync(contentUrl, destinationUri, {
      headers,
      signal: controller.signal,
      onProgress: ({ bytesWritten, totalBytes }) => {
        if (bytesWritten > maxBytes || totalBytes > maxBytes) {
          exceededLimit = true;
          controller.abort();
        }
      },
    });

    const info = await FileSystem.getInfoAsync(destinationUri);
    if (!info.exists || (info.size !== undefined && info.size > maxBytes)) {
      exceededLimit = info.size !== undefined && info.size > maxBytes;
      throw new Error('Artifact download did not produce a valid file');
    }

    return ok(destinationUri);
  } catch (error) {
    await FileSystem.deleteAsync(destinationUri, { idempotent: true }).catch(() => undefined);
    if (exceededLimit) {
      return err(
        new Error(
          `Artifact exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MB mobile download limit`
        )
      );
    }
    logger.error('Failed to download artifact', { contentUrl, error });
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

export async function fetchArtifactContentText(contentUrl: string): Promise<Result<string>> {
  try {
    const response = await getMobilePinnedFetch()(contentUrl, {
      headers: await authHeaders(),
    });
    const body = await response.text();
    if (!response.ok) {
      let rawError: unknown = null;
      try {
        rawError = JSON.parse(body);
      } catch {
        rawError = null;
      }
      return err(new Error(readApiErrorMessage(rawError) ?? 'Failed to load artifact preview'));
    }
    return ok(body);
  } catch (error) {
    logger.error('Failed to load artifact preview', { contentUrl, error });
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

export const createMobileArtifactPublicLink = artifactsClient.createArtifactPublicLink;
export const deleteMobileArtifact = artifactsClient.deleteArtifact;
