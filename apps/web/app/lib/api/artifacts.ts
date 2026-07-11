import type { ZodType } from 'zod';

import { getCsrfToken } from '@taskforceai/api-client/auth/csrf';
import {
  apiArtifactListSchema,
  apiArtifactSchema,
  apiArtifactShareSchema,
  apiArtifactVersionListSchema,
  parseArtifactApiPayload,
  publicArtifactSchema,
  type ApiArtifact as Artifact,
  type ApiArtifactShare as ArtifactShare,
  type ApiArtifactVersion as ArtifactVersion,
  type ApiArtifactVisibility as ArtifactVisibility,
  type PublicArtifact,
} from '@taskforceai/api-client/api/artifact-response';
import { type Result, err, ok } from '@taskforceai/client-core/result';
import { readApiErrorMessage } from '@taskforceai/api-client/api/response';
import { logger } from '../logger';
export type { Artifact, ArtifactShare, ArtifactVersion, ArtifactVisibility, PublicArtifact };

const ARTIFACT_PAGE_SIZE = 100;

function parseJsonSafe<T>(raw: unknown, schema: ZodType<T>): Result<T> {
  return parseArtifactApiPayload(raw, schema, (error) => {
    logger.warn('Artifact API response validation failed', { error: error.flatten() });
  });
}

async function readJsonResponse(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

async function getMutationHeaders(headers?: HeadersInit): Promise<Headers> {
  const nextHeaders = new Headers(headers);
  const csrfToken = await getCsrfToken();
  if (csrfToken) {
    nextHeaders.set('X-CSRF-Token', csrfToken);
  }
  return nextHeaders;
}

export const fetchArtifacts = async ({
  includeCurrentVersion = false,
  limit = 50,
  offset = 0,
}: {
  includeCurrentVersion?: boolean;
  limit?: number;
  offset?: number;
} = {}): Promise<Result<Artifact[]>> => {
  try {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });
    if (includeCurrentVersion) {
      params.set('include', 'currentVersion');
    }
    const response = await fetch(`/api/v1/artifacts?${params.toString()}`, {
      credentials: 'include',
    });
    const rawBody = await readJsonResponse(response);
    if (!response.ok) {
      return err(new Error(readApiErrorMessage(rawBody) ?? 'Failed to fetch artifacts'));
    }
    return parseJsonSafe(rawBody, apiArtifactListSchema);
  } catch (error) {
    logger.error('Failed to fetch artifacts', { error });
    return err(error instanceof Error ? error : new Error(String(error)));
  }
};

export const fetchAllArtifacts = async ({
  includeCurrentVersion = false,
}: {
  includeCurrentVersion?: boolean;
} = {}): Promise<Result<Artifact[]>> => {
  const artifacts: Artifact[] = [];

  for (let offset = 0; ; offset += ARTIFACT_PAGE_SIZE) {
    // oxlint-disable-next-line no-await-in-loop -- the next offset is known only after a full page.
    const result = await fetchArtifacts({
      includeCurrentVersion,
      limit: ARTIFACT_PAGE_SIZE,
      offset,
    });
    if (!result.ok) {
      return result;
    }

    artifacts.push(...result.value);
    if (result.value.length < ARTIFACT_PAGE_SIZE) {
      return ok(artifacts);
    }
  }
};

export const fetchArtifact = async (artifactId: string): Promise<Result<Artifact>> => {
  try {
    const response = await fetch(`/api/v1/artifacts/${encodeURIComponent(artifactId)}`, {
      credentials: 'include',
    });
    const rawBody = await readJsonResponse(response);
    if (!response.ok) {
      return err(new Error(readApiErrorMessage(rawBody) ?? 'Failed to fetch artifact'));
    }
    return parseJsonSafe(rawBody, apiArtifactSchema);
  } catch (error) {
    logger.error('Failed to fetch artifact', { artifactId, error });
    return err(error instanceof Error ? error : new Error(String(error)));
  }
};

export const fetchArtifactVersions = async (
  artifactId: string
): Promise<Result<ArtifactVersion[]>> => {
  try {
    const response = await fetch(`/api/v1/artifacts/${encodeURIComponent(artifactId)}/versions`, {
      credentials: 'include',
    });
    const rawBody = await readJsonResponse(response);
    if (!response.ok) {
      return err(new Error(readApiErrorMessage(rawBody) ?? 'Failed to fetch artifact versions'));
    }
    return parseJsonSafe(rawBody, apiArtifactVersionListSchema);
  } catch (error) {
    logger.error('Failed to fetch artifact versions', { artifactId, error });
    return err(error instanceof Error ? error : new Error(String(error)));
  }
};

export const updateArtifactVisibility = async (
  artifactId: string,
  visibility: Extract<ArtifactVisibility, 'PRIVATE' | 'ORGANIZATION'>
): Promise<Result<Artifact>> => {
  try {
    const headers = await getMutationHeaders({
      'Content-Type': 'application/json',
    });
    const response = await fetch(`/api/v1/artifacts/${encodeURIComponent(artifactId)}`, {
      method: 'PATCH',
      credentials: 'include',
      headers,
      body: JSON.stringify({ visibility }),
    });
    const rawBody = await readJsonResponse(response);
    if (!response.ok) {
      return err(new Error(readApiErrorMessage(rawBody) ?? 'Failed to update artifact'));
    }
    return parseJsonSafe(rawBody, apiArtifactSchema);
  } catch (error) {
    logger.error('Failed to update artifact visibility', { artifactId, visibility, error });
    return err(error instanceof Error ? error : new Error(String(error)));
  }
};

export const createArtifactPublicLink = async (
  artifactId: string
): Promise<Result<ArtifactShare>> => {
  try {
    const headers = await getMutationHeaders();
    const response = await fetch(
      `/api/v1/artifacts/${encodeURIComponent(artifactId)}/share/public`,
      {
        method: 'POST',
        credentials: 'include',
        headers,
      }
    );
    const rawBody = await readJsonResponse(response);
    if (!response.ok) {
      return err(new Error(readApiErrorMessage(rawBody) ?? 'Failed to create public link'));
    }
    return parseJsonSafe(rawBody, apiArtifactShareSchema);
  } catch (error) {
    logger.error('Failed to create artifact public link', { artifactId, error });
    return err(error instanceof Error ? error : new Error(String(error)));
  }
};

export const revokeArtifactPublicLinks = async (artifactId: string): Promise<Result<void>> => {
  try {
    const headers = await getMutationHeaders();
    const response = await fetch(
      `/api/v1/artifacts/${encodeURIComponent(artifactId)}/share/public`,
      {
        method: 'DELETE',
        credentials: 'include',
        headers,
      }
    );
    const rawBody = response.status === 204 ? null : await readJsonResponse(response);
    if (!response.ok) {
      return err(new Error(readApiErrorMessage(rawBody) ?? 'Failed to revoke public links'));
    }
    return ok(undefined);
  } catch (error) {
    logger.error('Failed to revoke artifact public links', { artifactId, error });
    return err(error instanceof Error ? error : new Error(String(error)));
  }
};

export const deleteArtifact = async (artifactId: string): Promise<Result<void>> => {
  try {
    const headers = await getMutationHeaders();
    const response = await fetch(`/api/v1/artifacts/${encodeURIComponent(artifactId)}`, {
      method: 'DELETE',
      credentials: 'include',
      headers,
    });
    const rawBody = response.status === 204 ? null : await readJsonResponse(response);
    if (!response.ok) {
      return err(new Error(readApiErrorMessage(rawBody) ?? 'Failed to delete artifact'));
    }
    return ok(undefined);
  } catch (error) {
    logger.error('Failed to delete artifact', { artifactId, error });
    return err(error instanceof Error ? error : new Error(String(error)));
  }
};

export const fetchPublicArtifact = async (token: string): Promise<Result<PublicArtifact>> => {
  try {
    const response = await fetch(`/api/v1/artifacts/public/${encodeURIComponent(token)}`);
    const rawBody = await readJsonResponse(response);
    if (!response.ok) {
      return err(new Error(readApiErrorMessage(rawBody) ?? 'Failed to fetch public artifact'));
    }
    return parseJsonSafe(rawBody, publicArtifactSchema);
  } catch (error) {
    logger.error('Failed to fetch public artifact', { error });
    return err(error instanceof Error ? error : new Error(String(error)));
  }
};
