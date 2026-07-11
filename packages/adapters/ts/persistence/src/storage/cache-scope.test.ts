import { describe, expect, it } from 'bun:test';

import {
  ANONYMOUS_CACHE_SCOPE,
  normalizeCacheScopeSegment,
  resolveUserCacheScope,
} from './cache-scope';

describe('cache scope storage helpers', () => {
  it('uses numeric user IDs before email addresses', () => {
    expect(resolveUserCacheScope({ ok: true, value: { id: 7, email: 'owner@test.dev' } })).toBe(
      'id-7'
    );
  });

  it('normalizes email fallback scopes', () => {
    expect(normalizeCacheScopeSegment('Owner+Admin@TaskForceAI.Chat')).toBe(
      'owner_admin_taskforceai.chat'
    );
    expect(resolveUserCacheScope({ ok: true, value: { email: 'Owner@TaskForceAI.Chat' } })).toBe(
      'email-owner_taskforceai.chat'
    );
  });

  it('falls back to the anonymous scope when no stable user identifier is available', () => {
    expect(resolveUserCacheScope({ ok: false })).toBe(ANONYMOUS_CACHE_SCOPE);
    expect(resolveUserCacheScope({ ok: true, value: {} })).toBe(ANONYMOUS_CACHE_SCOPE);
    expect(resolveUserCacheScope({ ok: true, value: { id: Number.NaN, email: '' } })).toBe(
      ANONYMOUS_CACHE_SCOPE
    );
  });
});
