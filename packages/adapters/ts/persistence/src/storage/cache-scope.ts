export const ANONYMOUS_CACHE_SCOPE = 'anonymous';

export type CacheScopeUser = {
  email?: unknown;
  id?: unknown;
};

export type CacheScopeUserResult =
  | { ok: true; value: CacheScopeUser }
  | { ok: false; error?: unknown };

export const normalizeCacheScopeSegment = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '_');

export const resolveUserCacheScope = (userResult: CacheScopeUserResult): string => {
  if (!userResult.ok) {
    return ANONYMOUS_CACHE_SCOPE;
  }

  if (typeof userResult.value.id === 'number' && Number.isFinite(userResult.value.id)) {
    return `id-${userResult.value.id}`;
  }

  if (typeof userResult.value.email === 'string' && userResult.value.email.length > 0) {
    return `email-${normalizeCacheScopeSegment(userResult.value.email)}`;
  }

  return ANONYMOUS_CACHE_SCOPE;
};
