import { useQuery } from '@tanstack/react-query';

import { getMobileBaseUrl } from '../../config/base-url';
import { createModuleLogger } from '../../logger';
import { getMobilePinnedFetch } from '../../api/client';
import { sqliteStorage } from '../../storage/sqlite-adapter';
import { err, ok, type Result } from '@taskforceai/client-core/result';
import {
  apiArtifactListSchema,
  apiArtifactShareSchema,
  apiArtifactVersionListSchema,
  parseArtifactApiPayload,
  type ApiArtifact as MobileArtifact,
  type ApiArtifactShare as MobileArtifactShare,
  type ApiArtifactVersion as MobileArtifactVersion,
} from '@taskforceai/api-client/api/artifact-response';
import { readApiErrorMessage } from '@taskforceai/api-client/api/response';
import { queryKeys } from './queryKeys';
import * as FileSystem from '../../utils/file-system';
import {
  assertProductionDomain,
  assertProductionPinConfiguration,
} from '../../security/certificate-pinning';

const logger = createModuleLogger('MobileArtifacts');
export type { MobileArtifact, MobileArtifactShare, MobileArtifactVersion };
const MAX_MOBILE_ARTIFACT_DOWNLOAD_BYTES = 100 * 1024 * 1024;

type FetchArtifactsOptions = {
  includeCurrentVersion?: boolean;
  limit?: number;
  offset?: number;
};

const absoluteApiUrl = (path: string): string => `${getMobileBaseUrl().replace(/\/+$/, '')}${path}`;

const authHeaders = async (): Promise<Headers> => {
  const headers = new Headers({
    Accept: 'application/json',
    'User-Agent': 'TaskForceAI-Mobile',
  });
  const session = await sqliteStorage.getSession();
  if (session.ok && session.value.accessToken) {
    headers.set('Authorization', `Bearer ${session.value.accessToken}`);
  }
  return headers;
};

const readJsonResponse = async (response: Response): Promise<unknown> => response.json().catch(() => null);

const parseArtifacts = (raw: unknown): Result<MobileArtifact[]> => {
  return parseArtifactApiPayload(raw, apiArtifactListSchema, (error) => {
    logger.warn('Artifact API response validation failed', { error: error.flatten() });
  });
};

async function fetchMobileArtifacts({
  includeCurrentVersion = true,
  limit = 50,
  offset = 0,
}: FetchArtifactsOptions = {}): Promise<Result<MobileArtifact[]>> {
  try {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });
    if (includeCurrentVersion) {
      params.set('include', 'currentVersion');
    }

    const response = await getMobilePinnedFetch()(absoluteApiUrl(`/api/v1/artifacts?${params.toString()}`), {
      headers: await authHeaders(),
    });
    const rawBody = await readJsonResponse(response);
    if (!response.ok) {
      return err(new Error(readApiErrorMessage(rawBody) ?? 'Failed to fetch artifacts'));
    }
    return parseArtifacts(rawBody);
  } catch (error) {
    logger.error('Failed to fetch artifacts', { error });
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

export function useArtifactsQuery(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.artifacts,
    queryFn: async () => {
      const result = await fetchMobileArtifacts({ includeCurrentVersion: true });
      if (!result.ok) {
        throw result.error;
      }
      return result.value;
    },
    enabled,
    staleTime: 60_000,
  });
}

export function useArtifactVersionsQuery(artifactId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: artifactId ? queryKeys.artifactVersions(artifactId) : ['artifacts', 'versions', 'idle'],
    queryFn: async () => {
      if (!artifactId) {
        return [];
      }
      const result = await fetchMobileArtifactVersions(artifactId);
      if (!result.ok) {
        throw result.error;
      }
      return result.value;
    },
    enabled: enabled && !!artifactId,
    staleTime: 60_000,
  });
}

async function fetchMobileArtifactVersions(
  artifactId: string
): Promise<Result<MobileArtifactVersion[]>> {
  try {
    const response = await getMobilePinnedFetch()(
      absoluteApiUrl(`/api/v1/artifacts/${encodeURIComponent(artifactId)}/versions`),
      {
        headers: await authHeaders(),
      }
    );
    const rawBody = await readJsonResponse(response);
    if (!response.ok) {
      return err(new Error(readApiErrorMessage(rawBody) ?? 'Failed to fetch artifact versions'));
    }
    return parseArtifactApiPayload(rawBody, apiArtifactVersionListSchema, (error) => {
      logger.warn('Artifact version response validation failed', { error: error.flatten() });
    });
  } catch (error) {
    logger.error('Failed to fetch artifact versions', { artifactId, error });
    return err(error instanceof Error ? error : new Error(String(error)));
  }
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

export async function createMobileArtifactPublicLink(
  artifactId: string
): Promise<Result<MobileArtifactShare>> {
  try {
    const response = await getMobilePinnedFetch()(
      absoluteApiUrl(`/api/v1/artifacts/${encodeURIComponent(artifactId)}/share/public`),
      {
        method: 'POST',
        headers: await authHeaders(),
      }
    );
    const rawBody = await readJsonResponse(response);
    if (!response.ok) {
      return err(new Error(readApiErrorMessage(rawBody) ?? 'Failed to create public link'));
    }
    return parseArtifactApiPayload(rawBody, apiArtifactShareSchema, (error) => {
      logger.warn('Artifact share response validation failed', { error: error.flatten() });
    });
  } catch (error) {
    logger.error('Failed to create artifact public link', { artifactId, error });
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

export async function deleteMobileArtifact(artifactId: string): Promise<Result<void>> {
  try {
    const response = await getMobilePinnedFetch()(
      absoluteApiUrl(`/api/v1/artifacts/${encodeURIComponent(artifactId)}`),
      {
        method: 'DELETE',
        headers: await authHeaders(),
      }
    );
    const rawBody = response.status === 204 ? null : await readJsonResponse(response);
    if (!response.ok) {
      return err(new Error(readApiErrorMessage(rawBody) ?? 'Failed to delete artifact'));
    }
    return ok(undefined);
  } catch (error) {
    logger.error('Failed to delete artifact', { artifactId, error });
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
