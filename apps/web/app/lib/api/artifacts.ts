import {
  createArtifactsClient,
  type ApiArtifact as Artifact,
  type ApiArtifactShare as ArtifactShare,
  type ApiArtifactVersion as ArtifactVersion,
  type ApiArtifactVisibility as ArtifactVisibility,
  type ArtifactRequest,
  type PublicArtifact,
} from '@taskforceai/api-client/api/artifacts';
import { getCsrfToken } from '@taskforceai/api-client/auth/csrf';

import { logger } from '../logger';

export type { Artifact, ArtifactShare, ArtifactVersion, ArtifactVisibility, PublicArtifact };

const mutationMethods = new Set(['DELETE', 'PATCH', 'POST', 'PUT']);

const request: ArtifactRequest = async (path, init, authenticated = true) => {
  if (!authenticated) return init ? fetch(path, init) : fetch(path);

  const nextInit: RequestInit = { ...init, credentials: 'include' };
  if (mutationMethods.has((init?.method ?? 'GET').toUpperCase())) {
    const headers = new Headers(init?.headers);
    const csrfToken = await getCsrfToken();
    if (csrfToken) headers.set('X-CSRF-Token', csrfToken);
    nextInit.headers = headers;
  }
  return fetch(path, nextInit);
};

const artifactsClient = createArtifactsClient({
  request,
  onError: (message, details) => logger.error(message, details),
  onInvalid: (_operation, error) =>
    logger.warn('Artifact API response validation failed', { error: error.flatten() }),
});

export const fetchArtifacts = artifactsClient.fetchArtifacts;
export const fetchAllArtifacts = artifactsClient.fetchAllArtifacts;
export const fetchArtifact = artifactsClient.fetchArtifact;
export const fetchArtifactVersions = artifactsClient.fetchArtifactVersions;
export const updateArtifactVisibility = artifactsClient.updateArtifactVisibility;
export const createArtifactPublicLink = artifactsClient.createArtifactPublicLink;
export const revokeArtifactPublicLinks = artifactsClient.revokeArtifactPublicLinks;
export const deleteArtifact = artifactsClient.deleteArtifact;
export const fetchPublicArtifact = artifactsClient.fetchPublicArtifact;
