import { type Result, err, ok } from '@taskforceai/client-core/result';
import type { ZodError, ZodType } from 'zod';

import {
  apiArtifactListSchema,
  apiArtifactSchema,
  apiArtifactShareSchema,
  apiArtifactVersionListSchema,
  parseArtifactApiPayload,
  publicArtifactSchema,
  type ApiArtifact,
  type ApiArtifactShare,
  type ApiArtifactVersion,
  type ApiArtifactVisibility,
  type PublicArtifact,
} from './artifact-response';
import { readApiErrorMessage } from './response';

const ARTIFACT_PAGE_SIZE = 100;

const operationMessages = {
  fetchArtifacts: ['Failed to fetch artifacts', 'Failed to fetch artifacts'],
  fetchArtifact: ['Failed to fetch artifact', 'Failed to fetch artifact'],
  fetchArtifactVersions: ['Failed to fetch artifact versions', 'Failed to fetch artifact versions'],
  updateArtifactVisibility: ['Failed to update artifact', 'Failed to update artifact visibility'],
  createArtifactPublicLink: [
    'Failed to create public link',
    'Failed to create artifact public link',
  ],
  revokeArtifactPublicLinks: [
    'Failed to revoke public links',
    'Failed to revoke artifact public links',
  ],
  deleteArtifact: ['Failed to delete artifact', 'Failed to delete artifact'],
  fetchPublicArtifact: ['Failed to fetch public artifact', 'Failed to fetch public artifact'],
} as const;

export type ArtifactOperation = keyof typeof operationMessages;
export type ArtifactRequest = (
  path: string,
  init?: RequestInit,
  authenticated?: boolean
) => Promise<Response>;

export type FetchArtifactsOptions = {
  includeCurrentVersion?: boolean;
  limit?: number;
  offset?: number;
};

export type ArtifactsClientOptions = {
  request: ArtifactRequest;
  onError?: (message: string, details: Record<string, unknown>) => void;
  onInvalid?: (operation: ArtifactOperation, error: ZodError) => void;
};

const readJsonResponse = (response: Response): Promise<unknown> =>
  response.json().catch(() => null);

export const createArtifactsClient = ({ request, onError, onInvalid }: ArtifactsClientOptions) => {
  const execute = async <T>(
    operation: ArtifactOperation,
    path: string,
    schema: ZodType<T> | undefined,
    init?: RequestInit,
    details: Record<string, unknown> = {},
    authenticated = true
  ): Promise<Result<T>> => {
    try {
      const response = await request(path, init, authenticated);
      const rawBody = response.status === 204 ? null : await readJsonResponse(response);
      if (!response.ok) {
        return err(new Error(readApiErrorMessage(rawBody) ?? operationMessages[operation][0]));
      }
      if (!schema) return ok(undefined as T);
      return parseArtifactApiPayload(rawBody, schema, (error) => onInvalid?.(operation, error));
    } catch (error) {
      onError?.(operationMessages[operation][1], { ...details, error });
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  };

  const fetchArtifacts = ({
    includeCurrentVersion = false,
    limit = 50,
    offset = 0,
  }: FetchArtifactsOptions = {}): Promise<Result<ApiArtifact[]>> => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (includeCurrentVersion) params.set('include', 'currentVersion');
    return execute('fetchArtifacts', `/api/v1/artifacts?${params}`, apiArtifactListSchema);
  };

  const fetchAllArtifacts = async ({
    includeCurrentVersion = false,
  }: Pick<FetchArtifactsOptions, 'includeCurrentVersion'> = {}): Promise<Result<ApiArtifact[]>> => {
    const artifacts: ApiArtifact[] = [];
    for (let offset = 0; ; offset += ARTIFACT_PAGE_SIZE) {
      // oxlint-disable-next-line no-await-in-loop -- the next offset is known only after a full page.
      const result = await fetchArtifacts({
        includeCurrentVersion,
        limit: ARTIFACT_PAGE_SIZE,
        offset,
      });
      if (!result.ok) return result;
      artifacts.push(...result.value);
      if (result.value.length < ARTIFACT_PAGE_SIZE) return ok(artifacts);
    }
  };

  const executeForArtifact = <T>(
    operation: ArtifactOperation,
    artifactId: string,
    suffix: string,
    schema: ZodType<T> | undefined,
    init?: RequestInit,
    details: Record<string, unknown> = {}
  ): Promise<Result<T>> =>
    execute(
      operation,
      `/api/v1/artifacts/${encodeURIComponent(artifactId)}${suffix}`,
      schema,
      init,
      { artifactId, ...details }
    );

  return {
    fetchArtifacts,
    fetchAllArtifacts,
    fetchArtifact: (artifactId: string): Promise<Result<ApiArtifact>> =>
      executeForArtifact('fetchArtifact', artifactId, '', apiArtifactSchema),
    fetchArtifactVersions: (artifactId: string): Promise<Result<ApiArtifactVersion[]>> =>
      executeForArtifact(
        'fetchArtifactVersions',
        artifactId,
        '/versions',
        apiArtifactVersionListSchema
      ),
    updateArtifactVisibility: (
      artifactId: string,
      visibility: Extract<ApiArtifactVisibility, 'PRIVATE' | 'ORGANIZATION'>
    ): Promise<Result<ApiArtifact>> =>
      executeForArtifact(
        'updateArtifactVisibility',
        artifactId,
        '',
        apiArtifactSchema,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visibility }),
        },
        { artifactId, visibility }
      ),
    createArtifactPublicLink: (artifactId: string): Promise<Result<ApiArtifactShare>> =>
      executeForArtifact(
        'createArtifactPublicLink',
        artifactId,
        '/share/public',
        apiArtifactShareSchema,
        { method: 'POST' }
      ),
    revokeArtifactPublicLinks: (artifactId: string): Promise<Result<void>> =>
      executeForArtifact('revokeArtifactPublicLinks', artifactId, '/share/public', undefined, {
        method: 'DELETE',
      }),
    deleteArtifact: (artifactId: string): Promise<Result<void>> =>
      executeForArtifact('deleteArtifact', artifactId, '', undefined, { method: 'DELETE' }),
    fetchPublicArtifact: (token: string): Promise<Result<PublicArtifact>> =>
      execute(
        'fetchPublicArtifact',
        `/api/v1/artifacts/public/${encodeURIComponent(token)}`,
        publicArtifactSchema,
        undefined,
        {},
        false
      ),
  };
};

export type {
  ApiArtifact,
  ApiArtifactShare,
  ApiArtifactVersion,
  ApiArtifactVisibility,
  PublicArtifact,
};
