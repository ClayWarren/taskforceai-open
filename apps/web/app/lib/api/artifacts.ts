import { z } from 'zod';

import { getCsrfToken } from '@taskforceai/contracts/auth/csrf';
import { type Result, err, ok } from '@taskforceai/shared/result';
import { readApiErrorMessage } from '@taskforceai/shared/utils/api';
import { logger } from '../logger';

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
const publicArtifactSchema = z.object({
  artifact: artifactSchema,
  version: artifactVersionSchema,
});

export type Artifact = z.infer<typeof artifactSchema>;
export type ArtifactVersion = z.infer<typeof artifactVersionSchema>;
export type ArtifactVisibility = z.infer<typeof artifactVisibilitySchema>;
export type ArtifactShare = z.infer<typeof artifactShareSchema>;
export type PublicArtifact = z.infer<typeof publicArtifactSchema>;

function parseJsonSafe<T>(raw: unknown, schema: z.ZodType<T>): Result<T> {
  const parsed = schema.safeParse(raw);
  if (parsed.success) {
    return ok(parsed.data);
  }
  logger.warn('Artifact API response validation failed', { error: parsed.error.flatten() });
  return err(new Error('Invalid response from server'));
}

async function readJsonResponse(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
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
    return parseJsonSafe(rawBody, artifactListSchema);
  } catch (error) {
    logger.error('Failed to fetch artifacts', { error });
    return err(error instanceof Error ? error : new Error(String(error)));
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
    return parseJsonSafe(rawBody, artifactSchema);
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
    return parseJsonSafe(rawBody, artifactVersionListSchema);
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
    const response = await fetch(`/api/v1/artifacts/${encodeURIComponent(artifactId)}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ visibility }),
    });
    const rawBody = await readJsonResponse(response);
    if (!response.ok) {
      return err(new Error(readApiErrorMessage(rawBody) ?? 'Failed to update artifact'));
    }
    return parseJsonSafe(rawBody, artifactSchema);
  } catch (error) {
    logger.error('Failed to update artifact visibility', { artifactId, visibility, error });
    return err(error instanceof Error ? error : new Error(String(error)));
  }
};

export const createArtifactPublicLink = async (
  artifactId: string
): Promise<Result<ArtifactShare>> => {
  try {
    const response = await fetch(
      `/api/v1/artifacts/${encodeURIComponent(artifactId)}/share/public`,
      {
        method: 'POST',
        credentials: 'include',
      }
    );
    const rawBody = await readJsonResponse(response);
    if (!response.ok) {
      return err(new Error(readApiErrorMessage(rawBody) ?? 'Failed to create public link'));
    }
    return parseJsonSafe(rawBody, artifactShareSchema);
  } catch (error) {
    logger.error('Failed to create artifact public link', { artifactId, error });
    return err(error instanceof Error ? error : new Error(String(error)));
  }
};

export const revokeArtifactPublicLinks = async (artifactId: string): Promise<Result<void>> => {
  try {
    const csrfToken = await getCsrfToken();
    const response = await fetch(
      `/api/v1/artifacts/${encodeURIComponent(artifactId)}/share/public`,
      {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          'X-CSRF-Token': csrfToken,
        },
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
    const csrfToken = await getCsrfToken();
    const response = await fetch(`/api/v1/artifacts/${encodeURIComponent(artifactId)}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: {
        'X-CSRF-Token': csrfToken,
      },
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
    logger.error('Failed to fetch public artifact', { token, error });
    return err(error instanceof Error ? error : new Error(String(error)));
  }
};
