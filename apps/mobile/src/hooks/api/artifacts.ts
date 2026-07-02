import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { getMobileBaseUrl } from '../../config/base-url';
import { createModuleLogger } from '../../logger';
import { getMobilePinnedFetch } from '../../api/client';
import { sqliteStorage } from '../../storage/sqlite-adapter';
import { err, ok, type Result } from '@taskforceai/shared/result';
import { readApiErrorMessage } from '@taskforceai/shared/utils/api';
import { queryKeys } from './queryKeys';

const logger = createModuleLogger('MobileArtifacts');

const artifactStatusSchema = z.enum(['PROCESSING', 'READY', 'FAILED', 'DELETED']);
const artifactTypeSchema = z.enum([
  'DOCUMENT',
  'SPREADSHEET',
  'CHART',
  'IMAGE',
  'VIDEO',
  'SITE',
  'DASHBOARD',
  'ARCHIVE',
  'OTHER',
]);
const artifactVisibilitySchema = z.enum(['PRIVATE', 'ORGANIZATION', 'PUBLIC_LINK']);

const artifactVersionSchema = z.object({
  id: z.string(),
  artifactId: z.string(),
  version: z.number(),
  fileId: z.string().optional(),
  mimeType: z.string().optional(),
  filename: z.string().optional(),
  bytes: z.number().optional(),
  renderMetadata: z.unknown().optional(),
  sourceToolName: z.string().optional(),
  sourcePrompt: z.string().optional(),
  createdByUserId: z.number().optional(),
  createdAt: z.string(),
});

const artifactSchema = z.object({
  id: z.string(),
  organizationId: z.number().optional(),
  ownerUserId: z.number(),
  conversationId: z.number().optional(),
  messageId: z.string().optional(),
  taskId: z.string().optional(),
  type: artifactTypeSchema,
  title: z.string(),
  status: artifactStatusSchema,
  visibility: artifactVisibilitySchema,
  currentVersionId: z.string().optional(),
  currentVersion: artifactVersionSchema.optional(),
  metadata: z.unknown().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const artifactListSchema = z.array(artifactSchema);
const artifactVersionListSchema = z.array(artifactVersionSchema);
const artifactShareSchema = z.object({
  token: z.string(),
  url: z.string(),
  artifact: artifactSchema,
});

export type MobileArtifact = z.infer<typeof artifactSchema>;
export type MobileArtifactVersion = z.infer<typeof artifactVersionSchema>;
export type MobileArtifactShare = z.infer<typeof artifactShareSchema>;

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
  const parsed = artifactListSchema.safeParse(raw);
  if (parsed.success) {
    return ok(parsed.data);
  }
  logger.warn('Artifact API response validation failed', { error: parsed.error.flatten() });
  return err(new Error('Invalid response from server'));
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
    const parsed = artifactVersionListSchema.safeParse(rawBody);
    if (!parsed.success) {
      logger.warn('Artifact version response validation failed', { error: parsed.error.flatten() });
      return err(new Error('Invalid response from server'));
    }
    return ok(parsed.data);
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

export async function fetchArtifactContentBytes(contentUrl: string): Promise<Result<Uint8Array>> {
  try {
    const response = await getMobilePinnedFetch()(contentUrl, {
      headers: await authHeaders(),
    });
    if (!response.ok) {
      const body = await response.text();
      let rawError: unknown = null;
      try {
        rawError = JSON.parse(body);
      } catch {
        rawError = null;
      }
      return err(new Error(readApiErrorMessage(rawError) ?? 'Failed to download artifact'));
    }
    return ok(new Uint8Array(await response.arrayBuffer()));
  } catch (error) {
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
    const parsed = artifactShareSchema.safeParse(rawBody);
    if (!parsed.success) {
      logger.warn('Artifact share response validation failed', { error: parsed.error.flatten() });
      return err(new Error('Invalid response from server'));
    }
    return ok(parsed.data);
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
